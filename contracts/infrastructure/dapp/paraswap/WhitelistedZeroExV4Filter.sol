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
 * @title WhitelistedZeroExV4Filter
 * @notice Filter used for calls to the ZeroExV4 exchange at 0xdef1c0ded9bec7f1a1670819833240f027b25eff.
 * Only trades with whitelisted market makers are allowed. Currently deployed to work with Paraswap's market makers only.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract WhitelistedZeroExV4Filter is BaseFilter {

    bytes4 private constant FILL = bytes4(keccak256(
        "fillRfqOrder((address,address,uint128,uint128,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)"
    ));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    // Supported ParaswapPool market makers
    mapping(address => bool) public marketMakers;

    constructor(address[] memory _marketMakers) {
        for(uint i = 0; i < _marketMakers.length; i++) {
            marketMakers[_marketMakers[i]] = true;
        }
    }

    function isValid(address /*_wallet*/, address _spender, address _to, bytes calldata _data) external view override returns (bool valid) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }

        bytes4 methodId = getMethod(_data);

        if(methodId == FILL) {
            ParaswapUtils.ZeroExV4Order memory order = abi.decode(_data[4:], (ParaswapUtils.ZeroExV4Order));
            return marketMakers[order.maker];
        } 
        
        return methodId == ERC20_APPROVE && _spender != _to;
    }
}