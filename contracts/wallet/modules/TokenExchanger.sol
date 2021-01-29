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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "../base/BaseModule.sol";
import "../base/Configuration.sol";
import "./ITokenExchanger.sol";

/**
 * @title TokenExchanger
 * @notice Module to trade tokens (ETH or ERC20) using ParaSwap.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract TokenExchanger is ITokenExchanger, BaseModule {

    // Signatures of Paraswap's trade methods
    // solhint-disable-next-line max-line-length
    bytes4 constant internal MULTISWAP = 0xcbd1603e; // bytes4(keccak256("multiSwap(address,address,uint256,uint256,uint256,(address,uint256,(address,address,uint256,bytes,uint256)[])[],uint256,address,uint256,string)"))
    // solhint-disable-next-line max-line-length
    bytes4 constant internal BUY = 0xbb2a349b; // bytes4(keccak256("buy(address,address,uint256,uint256,uint256,(address,address,uint256,uint256,bytes,uint256)[],uint256,address,uint256,string)"))

    /**
     * @inheritdoc ITokenExchanger
     */
    function sell(
        address _srcToken,
        address _destToken,
        uint256 _srcAmount,
        uint256 _minDestAmount,
        uint256 _expectedDestAmount,
        IAugustusSwapper.Path[] calldata _path,
        uint256 _mintPrice
    )
        external override
        onlyWalletOwner()
        onlyWhenUnlocked()
    {
        // Verify that the destination token is tradable
        verifyTradable(_destToken);
        // Verify that the exchange adapters used have been authorised
        verifyExchangeAdapters(_path);
        // Approve source amount if required
        uint previousAllowance = approveToken(_srcToken, _srcAmount);
        // Perform trade and emit event
        doSell(
            _srcToken,
            _destToken,
            _srcAmount,
            _minDestAmount,
            _expectedDestAmount,
            _path,
            _mintPrice);
        // Restore the previous allowance if needed. This should only be needed when the previous allowance
        // was infinite. In other cases, paraswap.multiSwap() should have used exactly the additional allowance
        // granted to it and therefore the previous allowance should have been restored.
        restoreAllowance(_srcToken, previousAllowance);
    }

    /**
     * @inheritdoc ITokenExchanger
     */
    function buy(
        address _srcToken,
        address _destToken,
        uint256 _maxSrcAmount,
        uint256 _destAmount,
        uint256 _expectedSrcAmount,
        IAugustusSwapper.BuyRoute[] calldata _routes,
        uint256 _mintPrice
    )
        external override
        onlyWalletOwner()
        onlyWhenUnlocked()
    {
        // Verify that the destination token is tradable
        verifyTradable(_destToken);
        // Verify that the exchange adapters used have been authorised
        verifyExchangeAdapters(_routes);
        // Approve source amount if required
        uint previousAllowance = approveToken(_srcToken, _maxSrcAmount);
        // Perform trade and emit event
        doBuy(
            _srcToken,
            _destToken,
            _maxSrcAmount,
            _destAmount,
            _expectedSrcAmount,
            _routes,
            _mintPrice);
        // Restore the previous allowance if needed (paraswap.buy() may not have used exactly the additional allowance granted to it)
        restoreAllowance(_srcToken, previousAllowance);
    }

    // Internal & Private Methods

    function verifyTradable(address _token) internal view {
        ITokenPriceRegistry tokenPriceRegistry = Configuration(registry).tokenPriceRegistry();
        require((_token == ETH_TOKEN) || tokenPriceRegistry.isTokenTradable(_token), "TE: Token not tradable");
    }

    function verifyExchangeAdapters(IAugustusSwapper.Path[] calldata _path) internal view {
        IDexRegistry dexRegistry = Configuration(registry).dexRegistry();
        dexRegistry.verifyExchangeAdapters(_path);
    }

    function verifyExchangeAdapters(IAugustusSwapper.BuyRoute[] calldata _routes) internal view {
        IDexRegistry dexRegistry = Configuration(registry).dexRegistry();
        dexRegistry.verifyExchangeAdapters(_routes);
    }

    function approveToken(address _token, uint _amount) internal returns (uint256 _existingAllowance) {
        address paraswapProxy = Configuration(registry).paraswapProxy();
        // TODO: Use a "safe approve" logic similar to the one implemented below in other modules
        if (_token != ETH_TOKEN) {
            _existingAllowance = ERC20(_token).allowance(address(this), paraswapProxy);
            if (_existingAllowance < uint256(-1)) {
                if (_existingAllowance > 0) {
                    // Clear the existing allowance to avoid issues with tokens like USDT that do not allow changing a non-zero allowance
                    ERC20(_token).approve(paraswapProxy, 0);
                }
                // Increase the allowance to include the required amount
                uint256 newAllowance = SafeMath.add(_existingAllowance, _amount);
                ERC20(_token).approve(paraswapProxy, newAllowance);
            }
        }
    }

    function restoreAllowance(address _token, uint _previousAllowance) internal {
        if (_token != ETH_TOKEN) {
            address paraswapProxy = Configuration(registry).paraswapProxy();
            uint allowance = ERC20(_token).allowance(address(this), paraswapProxy);
            if (allowance != _previousAllowance) {
                ERC20(_token).approve(paraswapProxy, _previousAllowance);
            }
        }
    }

    function doSell(
        address _srcToken,
        address _destToken,
        uint256 _srcAmount,
        uint256 _minDestAmount,
        uint256 _expectedDestAmount,
        IAugustusSwapper.Path[] calldata _path,
        uint256 _mintPrice
    )
        internal
    {
        // Perform the trade
        uint sellValue = (_srcToken == ETH_TOKEN) ? _srcAmount : 0;

        address paraswapSwapper = Configuration(registry).paraswapSwapper();
        string memory referrer = Configuration(registry).referrer();

        uint256 estimatedDestAmount = IAugustusSwapper(paraswapSwapper).multiSwap{value:sellValue}(
            IERC20(_srcToken),
            IERC20(_destToken),
            _srcAmount,
            _minDestAmount,
            _expectedDestAmount,
            _path,
            _mintPrice,
            address(0),
            0,
            referrer);
        // TODO if estimatedDestAmount is not decoded use _minDestAmount

        emit TokenExchanged(address(this), _srcToken, _srcAmount, _destToken, estimatedDestAmount);
    }

    function doBuy(
        address _srcToken,
        address _destToken,
        uint256 _maxSrcAmount,
        uint256 _destAmount,
        uint256 _expectedSrcAmount,
        IAugustusSwapper.BuyRoute[] calldata _routes,
        uint256 _mintPrice
    )
        internal
    {
        // Perform the trade
        uint sellValue = (_srcToken == ETH_TOKEN) ? _destAmount : 0;

        address paraswapSwapper = Configuration(registry).paraswapSwapper();
        uint256 estimatedDestAmount = IAugustusSwapper(paraswapSwapper).buy{value:sellValue}(
            IERC20(_srcToken),
            IERC20(_destToken),
            _maxSrcAmount,
            _destAmount,
            _expectedSrcAmount,
            _routes, _mintPrice,
            address(0),
            0,
            Configuration(registry).referrer());
        // TODO if estimatedDestAmount is not decoded use _minDestAmount

        emit TokenExchanged(address(this), _srcToken, _maxSrcAmount, _destToken, estimatedDestAmount);
    }
}