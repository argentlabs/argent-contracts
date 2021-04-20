// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity ^0.8.3;

import "../BaseFilter.sol";
import "./ParaswapUtils.sol";

/**
 * @title WhitelistedZeroExV2Filter
 * @notice Filter used for calls to the ZeroExV2 exchange at 0x080bf510fcbf18b91105470639e9561022937712.
 * Only trades with whitelisted market makers are allowed. Currently deployed to work with Paraswap's market makers only.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract WhitelistedZeroExV2Filter is BaseFilter {

    bytes4 private constant SELL = bytes4(keccak256(
        "marketSellOrdersNoThrow((address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[],uint256,bytes[])"
    ));

    // Supported ParaswapPool market makers
    mapping(address => bool) public marketMakers;

    constructor(address[] memory _marketMakers) {
        for(uint i = 0; i < _marketMakers.length; i++) {
            marketMakers[_marketMakers[i]] = true;
        }
    }

    function isValid(address /*_wallet*/, address /*_spender*/, address /*_to*/, bytes calldata _data) external view override returns (bool valid) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }

        bytes4 methodId = getMethod(_data);

        if(methodId == SELL) {
            ParaswapUtils.ZeroExV2Order[] memory orders = abi.decode(_data[4:], (ParaswapUtils.ZeroExV2Order[]));
            for(uint i = 0; i < orders.length; i++) {
                if(!marketMakers[orders[i].makerAddress]) {
                    return false;
                }
            }
            return true;
        }
        
        return false;
    }
}