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

        for (uint i; i < _authorisedExchanges.length; i++) {
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
        for (uint i; i < _path.length; i++) {
            for (uint j; j < _path[i].routes.length; j++) {
                require(authorisedExchanges[_path[i].routes[j].exchange], "TE: Unauthorised Exchange");
            }
        }

        // Approve source amount if required
        if (_srcToken != ETH_TOKEN_ADDRESS) {
            bytes memory approveData = abi.encodeWithSignature("approve(address,uint256)", paraswapProxy, _srcAmount);
            invokeWallet(_wallet, _srcToken, 0, approveData);
        }

        // Perform the trade
        bytes memory multiSwapData = abi.encodeWithSelector(MULTISWAP,
            _srcToken, _destToken, _srcAmount, _minDestAmount, _expectedDestAmount, _path, _mintPrice, address(0), 0, referrer);
        bytes memory swapRes = invokeWallet(_wallet, paraswapSwapper, _srcToken == ETH_TOKEN_ADDRESS ? _srcAmount : 0, multiSwapData);

        // Emit event with best possible estimate of destination amount
        uint256 estimatedDestAmount;
        if (swapRes.length > 0) {
            (estimatedDestAmount) = abi.decode(swapRes, (uint256));
        } else {
            estimatedDestAmount = _minDestAmount;
        }
        emit TokenExchanged(_wallet, _srcToken, _srcAmount, _destToken, estimatedDestAmount);
    }

}