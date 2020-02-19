// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.5.4;

import "../../lib/utils/SafeMath.sol";
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../defi/Invest.sol";

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
 * @title UniswapInvestManager
 * @dev Module to invest tokens with Uniswap in order to earn an interest
 * @author Julien Niset - <julien@argent.xyz>
 */
contract UniswapManager is Invest, BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "UniswapInvestManager";

    // The Uniswap Factory contract
    UniswapFactory public uniswapFactory;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        UniswapFactory _uniswapFactory
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        uniswapFactory = _uniswapFactory;
    }

    /* ********************************** Implementation of Invest ************************************* */

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _amount The amount of tokens to invest.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @return The amount of tokens that have been invested.
     */
    function addInvestment(
        BaseWallet _wallet,
        address _token,
        uint256 _amount,
        uint256 _period
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns (uint256 _invested)
    {
        _invested = addLiquidity(_wallet, _token, _amount);
        emit InvestmentAdded(address(_wallet), _token, _amount, _period);
    }

    /**
     * @dev Removes a fraction of the tokens from an investment.
     * @param _wallet The target wallet.s
     * @param _token The array of token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000.
     */
    function removeInvestment(
        BaseWallet _wallet,
        address _token,
        uint256 _fraction
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(_fraction <= 10000, "Uniswap: _fraction must be expressed in 1 per 10000");
        removeLiquidity(_wallet, _token, _fraction);
        emit InvestmentRemoved(address(_wallet), _token, _fraction);
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @return The value in tokens of the investment (including interests) and the time at which the investment can be removed.
     */
    function getInvestment(
        BaseWallet _wallet,
        address _token
    )
        external
        view
        returns (uint256 _tokenValue, uint256 _periodEnd)
    {
        address tokenPool = uniswapFactory.getExchange(_token);
        uint256 tokenPoolSize = ERC20(_token).balanceOf(tokenPool);
        uint shares = ERC20(tokenPool).balanceOf(address(_wallet));
        uint totalSupply = ERC20(tokenPool).totalSupply();
        _tokenValue = shares.mul(tokenPoolSize).mul(2).div(totalSupply);
        _periodEnd = 0;
    }

    /* ****************************************** Uniswap utilities ******************************************* */

    /**
     * @dev Adds liquidity to a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _token The address of the ERC20 token of the pair.
     * @param _amount The amount of tokens to add to the pool.
     */
    function addLiquidity(
        BaseWallet _wallet,
        address _token,
        uint256 _amount
    )
        internal
        returns (uint256)
    {
        require(_amount > 0, "Uniswap: can't add 0 liquidity");
        address tokenPool = uniswapFactory.getExchange(_token);
        require(tokenPool != address(0), "Uniswap: target token is not traded on Uniswap");

        uint256 tokenBalance = ERC20(_token).balanceOf(address(_wallet));
        if (_amount > tokenBalance) {
            uint256 ethToSwap = UniswapExchange(tokenPool).getEthToTokenOutputPrice(_amount - tokenBalance);
            require(ethToSwap <= address(_wallet).balance, "Uniswap: not enough ETH to swap");
            invokeWallet(address(_wallet), tokenPool, ethToSwap, abi.encodeWithSignature("ethToTokenSwapOutput(uint256,uint256)", _amount - tokenBalance, block.timestamp));
        }

        uint256 tokenLiquidity = ERC20(_token).balanceOf(tokenPool);
        uint256 ethLiquidity = tokenPool.balance;
        uint256 ethToPool = (_amount - 1).mul(ethLiquidity).div(tokenLiquidity);
        require(ethToPool <= address(_wallet).balance, "Uniswap: not enough ETH to pool");
        invokeWallet(address(_wallet), _token, 0, abi.encodeWithSignature("approve(address,uint256)", tokenPool, _amount));
        invokeWallet(
            address(_wallet),
            tokenPool,
            ethToPool,
            abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)",
            1,
            _amount,
            block.timestamp + 1));
        return _amount.mul(2);
    }

    /**
     * @dev Removes liquidity from a Uniswap ETH-ERC20 pair.
     * @param _wallet The target wallet
     * @param _token The address of the ERC20 token of the pair.
     * @param _fraction The fraction of pool shares to liquidate.
     */
    function removeLiquidity(
        BaseWallet _wallet,
        address _token,
        uint256 _fraction
    )
        internal
    {
        address tokenPool = uniswapFactory.getExchange(_token);
        require(tokenPool != address(0), "Uniswap: The target token is not traded on Uniswap");
        uint256 shares = ERC20(tokenPool).balanceOf(address(_wallet));
        invokeWallet(
            address(_wallet),
            tokenPool,
            0,
            abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256,uint256)",
            shares.mul(_fraction).div(10000),
            1,
            1,
            block.timestamp + 1));
    }
}

