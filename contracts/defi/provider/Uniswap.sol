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
contract Uniswap is Invest {

    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    /* ********************************** Implementation of Invest ************************************* */

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @param _oracles (optional) The address of one or more oracles contracts that may be used by the provider to query information on-chain.
     * @return The exact amount of each tokens that have been invested. 
     */
    function addInvestment(
        BaseWallet _wallet, 
        address[] calldata _tokens, 
        uint256[] calldata _amounts, 
        uint256 _period, 
        address[] calldata _oracles
    ) 
        external 
        returns (uint256[] memory _invested)
    {
        require(_tokens.length == 2 && _amounts.length == 2, "Uniswap: You must invest a token pair.");
        require(_oracles.length == 1, "Uniswap: invalid oracles length");
        _invested = new uint256[](2);
        if(_tokens[0] == ETH_TOKEN_ADDRESS) {
            (_invested[0], _invested[1]) = addLiquidityToPool(_wallet, UniswapFactory(_oracles[0]).getExchange(_tokens[1]), _tokens[1], _amounts[0], _amounts[1]);
        }
        else {
            require(_tokens[1] == ETH_TOKEN_ADDRESS, "Uniswap: One token of the pair must be ETH");
            (_invested[1], _invested[0]) = addLiquidityToPool(_wallet, UniswapFactory(_oracles[0]).getExchange(_tokens[0]), _tokens[0], _amounts[1], _amounts[0]);
        }
    }

    /**
     * @dev Removes a fraction of the tokens from an investment.
     * @param _wallet The target wallet.s
     * @param _tokens The array of token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000. 
     * @param _oracles (optional) The address of one or more oracles contracts that may be used by the provider to query information on-chain.
     */
    function removeInvestment(
        BaseWallet _wallet, 
        address[] calldata _tokens, 
        uint256 _fraction, 
        address[] calldata _oracles
    ) 
        external 
    {
        require(_tokens.length == 2, "Uniswap: You must invest a token pair.");
        require(_fraction <= 10000, "Uniswap: _fraction must be expressed in 1 per 10000");
        require(_oracles.length == 1, "Uniswap: invalid oracles length");
        address token;
        if(_tokens[0] == ETH_TOKEN_ADDRESS) {
            token = _tokens[1];
        }
        else {
            require(_tokens[1] == ETH_TOKEN_ADDRESS, "Uniswap: One token of the pair must be ETH");
            token = _tokens[0];
        }
        address pool = UniswapFactory(_oracles[0]).getExchange(token);
        uint256 shares = ERC20(pool).balanceOf(address(_wallet));
        removeLiquidityFromPool(_wallet, pool, token, shares.mul(_fraction).div(10000));
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
        address pool = UniswapFactory(_oracles[0]).getExchange(_token);
        uint256 ethPoolSize = address(pool).balance;
        uint256 tokenPoolSize = ERC20(_token).balanceOf(pool);
        uint shares = ERC20(pool).balanceOf(address(_wallet));
        _tokenValue = shares.mul(tokenPoolSize) + getInputToOutputPrice(shares.mul(ethPoolSize), ethPoolSize, tokenPoolSize);
        _periodEnd = 0;
    }

    /* ****************************************** Uniswap utilities ******************************************* */
 
    /**
     * @dev Adds liquidity to a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _pool The address of the Uniswap contract for the target pair.
     * @param _poolToken The address of the ERC20 token of the pair.
     * @param _ethAmount The amount of ETH available.
     * @param _tokenAmount The amount of ERC20 token available.
     */
    function addLiquidityToPool(
        BaseWallet _wallet, 
        address _pool,
        address _poolToken, 
        uint256 _ethAmount, 
        uint256 _tokenAmount
    )
        internal 
        returns (uint256 _ethPool, uint256 _tokenPool)
    {
        require(_pool != address(0), "Uniswap: target token is not traded on Uniswap");
        require(_ethAmount <= address(_wallet).balance, "Uniswap: not enough ETH");
        require(_tokenAmount <= ERC20(_poolToken).balanceOf(address(_wallet)), "Uniswap: not enough token");
        
        uint256 ethPoolSize = address(_pool).balance;
        uint256 tokenPoolSize = ERC20(_poolToken).balanceOf(_pool);

        uint256 tokenValue = _tokenAmount.mul(ethPoolSize).div(tokenPoolSize);
        bool preventSwap = preventSwap(_ethAmount, tokenValue);
        if(_ethAmount >= tokenValue) {
            if(preventSwap) {
                _tokenPool = _tokenAmount;
                _ethPool = tokenValue;
            }
            else {
                // swap some eth for tokens
                uint256 ethSwap;
                (ethSwap, _ethPool, _tokenPool) = computePooledValue(ethPoolSize, tokenPoolSize, _ethAmount, _tokenAmount);
                if(ethSwap > 0) {
                    _wallet.invoke(_pool, ethSwap, abi.encodeWithSignature("ethToTokenSwapInput(uint256,uint256)", 1, block.timestamp));
                }
            }
            _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", _pool, _tokenPool));
        }
        else {
            if(preventSwap) {
                _ethPool = _ethAmount;
                _tokenPool = _ethAmount.mul(tokenPoolSize).div(ethPoolSize);
                _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", _pool, _tokenPool));
            }
            else {
                // swap some tokens for eth
                uint256 tokenSwap;
                (tokenSwap, _tokenPool, _ethPool) = computePooledValue(tokenPoolSize, ethPoolSize, _tokenAmount, _ethAmount);
                _wallet.invoke(_poolToken, 0, abi.encodeWithSignature("approve(address,uint256)", _pool, tokenSwap + _tokenPool));
                if(tokenSwap > 0) {
                    _wallet.invoke(_pool, 0, abi.encodeWithSignature("tokenToEthSwapInput(uint256,uint256,uint256)", tokenSwap, 1, block.timestamp));
                }
            }   
        }
        // add liquidity
        _wallet.invoke(_pool, _ethPool - 1, abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)",1, _tokenPool, block.timestamp + 1));
    }

    /**
     * @dev Removes liquidity from a Uniswap ETH-ERC20 pair.©
     * @param _wallet The target wallet
     * @param _pool The address of the Uniswap contract for the target pair.
     * @param _poolToken The address of the ERC20 token of the pair.
     * @param _amount The amount of pool shares to liquidate.
     */
    function removeLiquidityFromPool(    
        BaseWallet _wallet, 
        address _pool,
        address _poolToken, 
        uint256 _amount
    )
        internal       
    {
        require(_pool != address(0), "Uniswap: The target token is not traded on Uniswap");
        _wallet.invoke(_pool, 0, abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256,uint256)",_amount, 1, 1, block.timestamp + 1));
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
        pure 
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
    function getInputToOutputPrice(
        uint256 _inputAmount, 
        uint256 _inputPoolSize, 
        uint256 _outputPoolSize
    ) 
        internal 
        pure 
        returns(uint256) 
    {
        if(_inputAmount == 0) {
            return 0;
        }
        uint256 inputAfterFee = _inputAmount.mul(997);
        uint256 numerator = inputAfterFee.mul(_outputPoolSize);
        uint256 denominator = (_inputPoolSize.mul(1000)).add(inputAfterFee);
        return numerator.div(denominator);
    }

    /**
     * @dev Returns true if the eth and tokens are within 95% of each other in (eth) value.
     * @param _ethValue The value of ETH provided.
     * @param _tokenValue The value of tokens provided (in ETH).
     * @return true if the 2 values are within 95% of each other.
     */
    function preventSwap(
        uint256 _ethValue, 
        uint256 _tokenValue
    ) 
        internal 
        pure 
        returns(bool) 
    {
        if(_ethValue != 0 && _tokenValue != 0) {
            uint ratio = _ethValue.mul(1000000).div(_tokenValue);
            return ratio >= 900000 && ratio <= 1052631; 
        }
        return false;
    }
}