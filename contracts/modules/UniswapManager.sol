pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../exchange/ERC20.sol";
import "../utils/SafeMath.sol";
import "../storage/GuardianStorage.sol";

interface UniswapFactory {
    function getExchange(address _token) external view returns(address);
}

/**
 * @title UniswapManager
 * @dev Contract enabling the wallet owner to pool tokens to a Uniswap liquidity pool.
 * @author Julien Niset - <julien@argent.im>
 */
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
        guardianStorage = GuardianStorage(_guardianStorage);
        uniswap = UniswapFactory(_uniswap);
    }
 
    /**
     * @dev Adds liquidity to a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _poolToken The address of the ERC20 token of the pair.
     * @param _ethAmount The amount of ETH available.
     * @param _tokenAmount The amount of ERC20 token available.
     */
    function addLiquidityToUniswap(
        BaseWallet _wallet, 
        address _poolToken, 
        uint256 _ethAmount, 
        uint256 _tokenAmount,
        bool _preventSwap
    )
        external 
        onlyOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(_ethAmount <= address(_wallet).balance, "UM: not enough ETH");
        require(_tokenAmount <= ERC20(_poolToken).balanceOf(address(_wallet)), "UM: not enough token");
        
        address pool = uniswap.getExchange(_poolToken);
        require(pool != address(0), "UM: target token is not traded on Uniswap");

        uint256 ethPoolSize = address(pool).balance;
        uint256 tokenPoolSize = ERC20(_poolToken).balanceOf(pool);
        uint256 ethPool;
        uint256 tokenPool;

        if(_ethAmount >= _tokenAmount.mul(ethPoolSize).div(tokenPoolSize)) {
            if(_preventSwap) {
                tokenPool = _tokenAmount;
                ethPool = tokenPool.mul(ethPoolSize).div(tokenPoolSize);
            }
            else {
                // swap some eth for tokens
                uint256 ethSwap;
                (ethSwap, ethPool, tokenPool) = computePooledValue(ethPoolSize, tokenPoolSize, _ethAmount, _tokenAmount);
                if(ethSwap > 0) {
                    _wallet.invoke(pool, ethSwap, abi.encodeWithSignature("ethToTokenSwapInput(uint256,uint256)", 1, block.timestamp));
                }
            }
            _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", pool, tokenPool));
        }
        else {
            if(_preventSwap) {
                ethPool = _ethAmount;
                tokenPool = _ethAmount.mul(tokenPoolSize).div(ethPoolSize);
                _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", pool, tokenPool));
            }
            else {
                // swap some tokens for eth
                uint256 tokenSwap;
                (tokenSwap, tokenPool, ethPool) = computePooledValue(tokenPoolSize, ethPoolSize, _tokenAmount, _ethAmount);
                _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", pool, tokenSwap + tokenPool));
                if(tokenSwap > 0) {
                    _wallet.invoke(pool, 0, abi.encodeWithSignature("tokenToEthSwapInput(uint256,uint256,uint256)", tokenSwap, 1, block.timestamp));
                }
            }   
        }
        // add liquidity
        _wallet.invoke(pool, ethPool - 1, abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)",1, tokenPool, block.timestamp + 1));
    }

    /**
     * @dev Removes liquidity from a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _poolToken The address of the ERC20 token of the pair.
     * @param _amount The amount of pool shares to liquidate.
     */
    function removeLiquidityFromUniswap(    
        BaseWallet _wallet, 
        address _poolToken, 
        uint256 _amount
    )
        external 
        onlyOwner(_wallet)
        onlyWhenUnlocked(_wallet)        
    {
        address pool = uniswap.getExchange(_poolToken);
        require(pool != address(0), "UM: The target token is not traded on Uniswap");
        _wallet.invoke(pool, 0, abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256,uint256)",_amount, 1, 1, block.timestamp + 1));
    }

    /**
     * @dev Computes the amount of tokens to swap and then pool given an amount of "major" and "minor" tokens,
     * where there are more value of "major" tokens then "minor".
     * @param _majorPoolSize The size of the pool in major tokens
     * @param _minorPoolSize The size of the pool in minor tokens
     * @param _majorAmount The amount of major token provided
     * @param _minorAmount The amount of minor token provided
     * @return the amount of major tokens to first swap and the amount of major and minor tokens that can be added to the pool after.
     */
    function computePooledValue(
        uint256 _majorPoolSize,
        uint256 _minorPoolSize, 
        uint256 _majorAmount,
        uint256 _minorAmount
    ) 
        internal 
        view 
        returns(uint256 _majorSwap, uint256 _majorPool, uint256 _minorPool) 
    {
        uint256 _minorInMajor = _minorAmount.mul(_majorPoolSize).div(_minorPoolSize); 
        _majorSwap = (_majorAmount.sub(_minorInMajor)).mul(1000).div(1997);
        uint256 minorSwap = getInputToOutputPrice(_majorSwap, _majorPoolSize, _minorPoolSize);
        _majorPool = _majorAmount.sub(_majorSwap);
        _minorPool = _majorPool.mul(_minorPoolSize.sub(minorSwap)).div(_majorPoolSize.add(_majorSwap));
        uint256 minorPoolMax = _minorAmount.add(minorSwap);
        if(_minorPool > minorPoolMax) {
            _minorPool = minorPoolMax;
            _majorPool = (_minorPool).mul(_majorPoolSize.add(_majorSwap)).div(_minorPoolSize.sub(minorSwap));
        }
    }

    /**
     * @dev Computes the amount of output tokens that can be obtained by swapping the provided amoutn of input.
     * @param _inputAmount The amount of input token.
     * @param _inputPoolSize The size of the input pool.
     * @param _outputPoolSize The size of the output pool.
     */
    function getInputToOutputPrice(uint256 _inputAmount, uint256 _inputPoolSize, uint256 _outputPoolSize) internal view returns(uint256) {
        if(_inputAmount == 0) {
            return 0;
        }
        uint256 inputAfterFee = _inputAmount.mul(997);
        uint256 numerator = inputAfterFee.mul(_outputPoolSize);
        uint256 denominator = (_inputPoolSize.mul(1000)).add(inputAfterFee);
        return numerator.div(denominator);
    }
}