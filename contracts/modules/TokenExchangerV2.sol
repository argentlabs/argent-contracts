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

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.10;
//solium-disable-next-line no-experimental
pragma experimental ABIEncoderV2;

import "./common/OnlyOwnerModule.sol";
import "../../lib/other/ERC20.sol";
import "../../lib/paraswap/IAugustusSwapper.sol";

/**
 * @title TokenExchangerV2
 * @dev Module to trade tokens (ETH or ERC20) using ParaSwap.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract TokenExchangerV2 is OnlyOwnerModule {

    bytes32 constant NAME = "TokenExchangerV2";

    using SafeMath for uint256;

    struct Route {
        address payable exchange;
        address targetExchange;
        uint percent;
        bytes payload;
        uint256 networkFee; // only used for 0xV3
    }

    struct Path {
        address to;
        uint256 totalNetworkFee; // only used for 0xV3
        Route[] routes;
    }

    struct BuyRoute {
        address payable exchange;
        address targetExchange;
        uint256 fromAmount;
        uint256 toAmount;
        bytes payload;
        uint256 networkFee; // only used for 0xV3
    }

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // Signatures of Paraswap's trade methods
    bytes4 constant internal MULTISWAP = 0xcbd1603e;
    bytes4 constant internal BUY = 0xbb2a349b;

    // The address of the Paraswap Proxy contract
    address public paraswapProxy;
    // The address of the Paraswap contract
    address public paraswapSwapper;
    // The label of the referrer
    string public referrer;
    // Authorised exchanges
    mapping(address => bool) public authorisedExchanges;

    event TokenExchanged(address indexed wallet, address srcToken, uint srcAmount, address destToken, uint destAmount);

    constructor(
        IModuleRegistry _registry,
        IGuardianStorage _guardianStorage,
        address _paraswap,
        string memory _referrer,
        address[] memory _authorisedExchanges
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        paraswapSwapper = _paraswap;
        paraswapProxy = IAugustusSwapper(_paraswap).getTokenTransferProxy();
        referrer = _referrer;

        for (uint i = 0; i < _authorisedExchanges.length; i++) {
            authorisedExchanges[_authorisedExchanges[i]] = true;
        }
    }

    function multiSwap(
        address _wallet,
        address _srcToken,
        address _destToken,
        uint256 _srcAmount,
        uint256 _minDestAmount,
        uint256 _expectedDestAmount,
        Path[] calldata _path,
        uint256 _mintPrice
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        // Verify that the exchange adapters used have been authorised
        verifyExchangeAdapters(_path);
        // Approve source amount if required
        uint previousAllowance = approveToken(_wallet, _srcToken, _srcAmount);
        // Perform trade and emit event
        doMultiSwap(
            _wallet,
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
        restoreAllowance(_wallet, _srcToken, previousAllowance);
    }

    function buy(
        address _wallet,
        address _srcToken,
        address _destToken,
        uint256 _maxSrcAmount,
        uint256 _destAmount,
        uint256 _expectedDestAmount,
        BuyRoute[] calldata _routes,
        uint256 _mintPrice
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        // Verify that the exchange adapters used have been authorised
        verifyExchangeAdapters(_routes);
        // Approve source amount if required
        uint previousAllowance = approveToken(_wallet, _srcToken, _maxSrcAmount);
        // Perform trade and emit event
        doBuy(
            _wallet,
            _srcToken,
            _destToken,
            _maxSrcAmount,
            _destAmount,
            _expectedDestAmount,
            _routes,
            _mintPrice);
        // Restore the previous allowance if needed (paraswap.buy() may not have used exactly the additional allowance granted to it)
        restoreAllowance(_wallet, _srcToken, previousAllowance);
    }

    // Internal & Private Methods

    function verifyExchangeAdapters(Path[] calldata _path) internal view {
        for (uint i = 0; i < _path.length; i++) {
            for (uint j = 0; j < _path[i].routes.length; j++) {
                require(authorisedExchanges[_path[i].routes[j].exchange], "TE: Unauthorised Exchange");
            }
        }
    }

    function verifyExchangeAdapters(BuyRoute[] calldata _routes) internal view {
        for (uint j = 0; j < _routes.length; j++) {
            require(authorisedExchanges[_routes[j].exchange], "TE: Unauthorised Exchange");
        }
    }

    function approveToken(address _wallet, address _token, uint _amount) internal returns (uint256 _existingAllowance) {
        // TODO: Use a "safe approve" logic similar to the one implemented below in other modules
        if (_token != ETH_TOKEN_ADDRESS) {
            _existingAllowance = ERC20(_token).allowance(_wallet, paraswapProxy);
            if (_existingAllowance < uint256(-1)) {
                if (_existingAllowance > 0) {
                    // Clear the existing allowance to avoid issues with tokens like USDT that do not allow changing a non-zero allowance
                    invokeWallet(_wallet, _token, 0, abi.encodeWithSignature("approve(address,uint256)", paraswapProxy, 0));
                }
                // Increase the allowance to include the required amount
                uint256 newAllowance = SafeMath.add(_existingAllowance, _amount);
                invokeWallet(_wallet, _token, 0, abi.encodeWithSignature("approve(address,uint256)", paraswapProxy, newAllowance));
            }
        }
    }

    function restoreAllowance(address _wallet, address _token, uint _previousAllowance) internal {
        if (_token != ETH_TOKEN_ADDRESS) {
            uint allowance = ERC20(_token).allowance(_wallet, paraswapProxy);
            if (allowance != _previousAllowance) {
                invokeWallet(_wallet, _token, 0, abi.encodeWithSignature("approve(address,uint256)", paraswapProxy, _previousAllowance));
            }
        }
    }

    function doTradeAndEmitEvent(
        address _wallet,
        address _srcToken,
        address _destToken,
        uint256 _srcAmount,
        uint256 _destAmount,
        bytes memory tradeData
    )
        internal
    {
        // Perform the trade
        bytes memory swapRes = invokeWallet(_wallet, paraswapSwapper, _srcToken == ETH_TOKEN_ADDRESS ? _srcAmount : 0, tradeData);

        // Emit event with best possible estimate of destination amount
        uint256 estimatedDestAmount;
        if (swapRes.length > 0) {
            (estimatedDestAmount) = abi.decode(swapRes, (uint256));
        } else {
            estimatedDestAmount = _destAmount;
        }
        emit TokenExchanged(_wallet, _srcToken, _srcAmount, _destToken, estimatedDestAmount);
    }

    function doMultiSwap(
        address _wallet,
        address _srcToken,
        address _destToken,
        uint256 _srcAmount,
        uint256 _minDestAmount,
        uint256 _expectedDestAmount,
        Path[] calldata _path,
        uint256 _mintPrice
    )
        internal
    {
        // Build the calldata
        string memory ref = referrer;
        bytes memory tradeData = abi.encodeWithSelector(MULTISWAP,
            _srcToken, _destToken, _srcAmount, _minDestAmount, _expectedDestAmount, _path, _mintPrice, address(0), 0, ref);

        // Perform the trade
        doTradeAndEmitEvent(_wallet, _srcToken, _destToken, _srcAmount, _minDestAmount, tradeData);
    }

    function doBuy(
        address _wallet,
        address _srcToken,
        address _destToken,
        uint256 _maxSrcAmount,
        uint256 _destAmount,
        uint256 _expectedDestAmount,
        BuyRoute[] calldata _routes,
        uint256 _mintPrice
    )
        internal
    {
        // Build the calldata
        string memory ref = referrer;
        bytes memory tradeData = abi.encodeWithSelector(BUY,
            _srcToken, _destToken, _maxSrcAmount, _destAmount, _expectedDestAmount, _routes, _mintPrice, address(0), 0, ref);

        // Perform the trade
        doTradeAndEmitEvent(_wallet, _srcToken, _destToken, _maxSrcAmount, _destAmount, tradeData);
    }

}