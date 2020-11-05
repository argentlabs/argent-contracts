// Copyright (C) 2020  Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./base/Owned.sol";
import "./IDexRegistry.sol";

/**
 * @title DexRegistry
 * @notice Simple registry containing whitelisted DEX adapters to be used with the TokenExchanger.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract DexRegistry is IDexRegistry, Owned {

    // Whitelisted DEX adapters
    mapping(address => bool) public isAuthorised;

    event DexAdded(address indexed _dex);
    event DexRemoved(address indexed _dex);


    /**
     * @notice Add/Remove a DEX adapter to/from the whitelist.
     * @param _dexes array of DEX adapters to add to (or remove from) the whitelist
     * @param _authorised array where each entry is true to add the corresponding DEX to the whitelist, false to remove it
     */
    function setAuthorised(address[] calldata _dexes, bool[] calldata _authorised) external onlyOwner {
        for(uint256 i = 0; i < _dexes.length; i++) {
            if(isAuthorised[_dexes[i]] != _authorised[i]) {
                isAuthorised[_dexes[i]] = _authorised[i];
                if(_authorised[i]) { 
                    emit DexAdded(_dexes[i]); 
                } else { 
                    emit DexRemoved(_dexes[i]);
                }
            }
        }
    }

    function verifyExchangeAdapters(IAugustusSwapper.Path[] calldata _path) external override view {
        for (uint i = 0; i < _path.length; i++) {
            for (uint j = 0; j < _path[i].routes.length; j++) {
                require(isAuthorised[_path[i].routes[j].exchange], "DR: Unauthorised DEX");
            }
        }
    }

    function verifyExchangeAdapters(IAugustusSwapper.BuyRoute[] calldata _routes) external override view {
        for (uint j = 0; j < _routes.length; j++) {
            require(isAuthorised[_routes[j].exchange], "DR: Unauthorised DEX");
        }
    }


}