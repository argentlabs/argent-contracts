pragma solidity ^0.5.4;
import "../../wallet/BaseWallet.sol";
import "../../exchange/ERC20.sol";
import "../../utils/SafeMath.sol";
import "../Invest.sol";

interface UniswapFactory {
    function getExchange(address _token) external view returns(address);
}

interface UniswapExchange {
    function getEthToTokenOutputPrice(uint256 _tokens_bought) external view returns (uint256);
    function getEthToTokenInputPrice(uint256 _eth_sold) external view returns (uint256);
    function getTokenToEthOutputPrice(uint256 _eth_bought) external view returns (uint256);
    function getTokenToEthInputPrice(uint256 _tokens_sold) external view returns (uint256);
}

/**
 * @title Uniswap
 * @dev Wrapper contract to integrate Uniswap.
 * The first item of the oracles array is the Uniswap Factory contract.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract UniswapProvider is Invest {

    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    /* ********************************** Implementation of Invest ************************************* */

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _amount The amount of tokens to invest.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @param _oracles (optional) The address of one or more oracles contracts that may be used by the provider to query information on-chain.
     * @return The amount of tokens that have been invested. 
     */
    function addInvestment(
        BaseWallet _wallet, 
        address _token, 
        uint256 _amount, 
        uint256 _period, 
        address[] calldata _oracles
    ) 
        external 
        returns (uint256 _invested)
    {
        require(_oracles.length == 1, "Uniswap: invalid oracles length");
        _invested = addLiquidity(_wallet, _oracles[0], _token, _amount);
    }

    /**
     * @dev Removes a fraction of the tokens from an investment.
     * @param _wallet The target wallet.s
     * @param _token The array of token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000. 
     * @param _oracles (optional) The address of one or more oracles contracts that may be used by the provider to query information on-chain.
     */
    function removeInvestment(
        BaseWallet _wallet, 
        address _token, 
        uint256 _fraction, 
        address[] calldata _oracles
    ) 
        external 
    {
        require(_fraction <= 10000, "Uniswap: _fraction must be expressed in 1 per 10000");
        require(_oracles.length == 1, "Uniswap: invalid oracles length");
        removeLiquidity(_wallet, _oracles[0], _token, _fraction);
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _oracles (optional) The address of one or more oracles contracts that may be used by the provider to query information on-chain.
     * @return The value in tokens of the investment (including interests) and the time at which the investment can be removed.
     */
    function getInvestment(
        BaseWallet _wallet, 
        address _token, 
        address[] calldata _oracles
    ) 
        external 
        view
        returns (uint256 _tokenValue, uint256 _periodEnd) 
    {
        address tokenPool = UniswapFactory(_oracles[0]).getExchange(_token);
        uint256 tokenPoolSize = ERC20(_token).balanceOf(tokenPool);
        uint shares = ERC20(tokenPool).balanceOf(address(_wallet));
        _tokenValue = shares.mul(tokenPoolSize).mul(2);
        _periodEnd = 0;
    }

    /* ****************************************** Uniswap utilities ******************************************* */
 
    /**
     * @dev Adds liquidity to a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _factory The address of the Uniswap Factory contract.
     * @param _token The address of the ERC20 token of the pair.
     * @param _amount The amount of tokens to add to the pool.
     */
    function addLiquidity(
        BaseWallet _wallet, 
        address _factory,
        address _token, 
        uint256 _amount
    )
        internal 
        returns (uint256)
    {
        address tokenPool = UniswapFactory(_factory).getExchange(_token);
        require(tokenPool != address(0), "Uniswap: target token is not traded on Uniswap");

        uint256 tokenBalance = ERC20(_token).balanceOf(address(_wallet));
        if(_amount < tokenBalance) {
            uint256 ethToSwap = UniswapExchange(tokenPool).getEthToTokenOutputPrice(_amount - tokenBalance);
            require(ethToSwap <= address(_wallet).balance, "Uniswap: not enough ETH to swap");
            _wallet.invoke(tokenPool, ethToSwap, abi.encodeWithSignature("ethToTokenSwapOutput(uint256,uint256)", _amount - tokenBalance, block.timestamp));
        }

        uint256 ethToPool = UniswapExchange(tokenPool).getTokenToEthInputPrice(_amount);
        require(ethToPool <= address(_wallet).balance, "Uniswap: not enough ETH to pool");
        _wallet.invoke(_token, 0, abi.encodeWithSignature("approve(address,uint256)", tokenPool, _amount));
        _wallet.invoke(tokenPool, ethToPool, abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)",1, _amount, block.timestamp + 1));
        return _amount.mul(2);
    }

    /**
     * @dev Removes liquidity from a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _factory The address of the Uniswap Factory contract.
     * @param _token The address of the ERC20 token of the pair.
     * @param _fraction The fraction of pool shares to liquidate.
     */
    function removeLiquidity(    
        BaseWallet _wallet, 
        address _factory,
        address _token, 
        uint256 _fraction
    )
        internal       
    {
        address tokenPool = UniswapFactory(_factory).getExchange(_token);
        require(tokenPool != address(0), "Uniswap: The target token is not traded on Uniswap");
        uint256 shares = ERC20(tokenPool).balanceOf(address(_wallet));
        _wallet.invoke(tokenPool, 0, abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256,uint256)", shares.mul(_fraction).div(10000), 1, 1, block.timestamp + 1));
    }
}