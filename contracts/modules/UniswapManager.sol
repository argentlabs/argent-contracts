pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../exchange/ERC20.sol";
import "../utils/SafeMath.sol";
import "../utils/SafeMath.sol";
import "../storage/GuardianStorage.sol";

interface UniswapFactory {
    function getExchange(address _token) external view returns(address);
}

interface UniswapExchange {
    function getEthToTokenInputPrice(uint256 _ethAmount) external view returns(uint256);
    function getTokenToEthInputPrice(uint256 _tokenAmount) external view returns(uint256);
}

// uniswap on Ropsten 0x9c83dCE8CA20E9aAF9D3efc003b2ea62aBC08351
//            Rinkeby 0xf5D915570BC477f9B8D6C0E980aA81757A3AaC36
contract UniswapManager is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "UniswapManager";

    using SafeMath for uint256;

    // The Uniswap factory contract
    UniswapFactory uniswap;
    // The Guardian storage 
    GuardianStorage public guardianStorage;

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "TT: wallet must be unlocked");
        _;
    }

    constructor(
        ModuleRegistry _registry, 
        GuardianStorage _guardianStorage, 
        address _uniswap
    ) 
        BaseModule(_registry, NAME) 
        public 
    {
        uniswap = UniswapFactory(_uniswap);
    }
 
    /**
     * @dev Adds liquidity to a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _poolToken The address of the ERC20 token of the pair.
     * @param _ethAmount The amount of ETH available.
     * @param _tokenAmount The amount of ERC20 token available.
     * @return the number of liquidity shares minted. 
     */
    function addLiquidityToUniswap(
        BaseWallet _wallet, 
        address _poolToken, 
        uint256 _ethAmount, 
        uint256 _tokenAmount
    )
        external 
        onlyOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns(uint256)
        
    {
        address pool = uniswap.getExchange(_poolToken);
        uint256 ethPoolSize = address(pool).balance;
        uint256 tokenPoolSize = ERC20(_poolToken).balanceOf(pool);

        uint256 ethToPool;
        uint256 tokenToPool;

        if(_tokenAmount == 0 || _ethAmount > _tokenAmount.mul(tokenPoolSize).div(ethPoolSize)) { 
            // we swap some eth for tokens
            uint256 tokenInEth = UniswapExchange(pool).getTokenToEthInputPrice(_tokenAmount);
            uint ethToSwap = computeUniswapFraction(_ethAmount + tokenInEth, ethPoolSize);
            ethToPool = (_ethAmount - ethToSwap);
            tokenToPool = UniswapExchange(pool).getEthToTokenInputPrice(ethToSwap);
            // do the swap
            _wallet.invoke(pool, ethToSwap, abi.encodeWithSignature("ethToTokenSwapInput(uint256,uint256)", tokenToPool, block.number));
            // approve the pool on erc20
            _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", pool, tokenToPool));
        }
        else { 
            // we swap some tokens for eth
            uint256 ethInToken = UniswapExchange(pool).getEthToTokenInputPrice(_ethAmount); 
            uint tokenToSwap = computeUniswapFraction(_tokenAmount + ethInToken, tokenPoolSize);
            tokenToPool = (_tokenAmount - tokenToSwap);
            ethToPool = UniswapExchange(pool).getTokenToEthInputPrice(tokenToSwap);
            // approve uniswap on erc20
            _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", pool, tokenToSwap + tokenToPool));
            // do the swap
            _wallet.invoke(pool, 0, abi.encodeWithSignature("tokenToEthSwapInput(uint256,uint256,uint256)", tokenToSwap, ethToPool, block.number));
        }
        // add liquidity
        _wallet.invoke(pool, ethToPool, abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)",0, tokenToPool, block.number));
        return ERC20(pool).balanceOf(address(_wallet));
    }

    /**
     * @dev Given an amount of input token 'x = x1 + x2', computes the fraction 'x2' that needs to be swapped on Uniswap 
     * such that 'x1' and 'SWAP(x2)' are equal in value and can be added to the liquidity pool.   
     * To compute 'x2' we use the approximation 'x2 >= (1000/1997) * x1 - [2*(997000)^2/(1997)^3] * x1^2 / X'.
     * @param _input The amount of input token.
     * @param _poolSize The amount of input token in the pool.
     * @return the fraction 'x2' that needs to be swapped on Uniswap.
     */
    function computeUniswapFraction(uint256 _input, uint256 _poolSize) private view returns (uint256) {
        if(_input == 0) {
            return 0;
        }
        return (1000 * _input).div(1997) - (249624 * _input).mul(_input).div(1000 * _poolSize);  
    } 
}