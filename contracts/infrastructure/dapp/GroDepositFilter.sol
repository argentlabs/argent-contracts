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

import "./BaseFilter.sol";

/**
 * @title GroDepositFilter
 * @notice Filter used for deposits to Gro Protocol
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract GroDepositFilter is BaseFilter {

    bytes4 private constant DEPOSIT1 = bytes4(keccak256("depositPwrd(uint256[3],uint256,address)"));
    bytes4 private constant DEPOSIT2 = bytes4(keccak256("depositGvt(uint256[3],uint256,address)"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    function isValid(address /*_wallet*/, address _spender, address _to, bytes calldata _data) external view override returns (bool valid) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }

        bytes4 methodId = getMethod(_data);
        if(_spender == _to) {
            return (methodId == DEPOSIT1 || methodId == DEPOSIT2);
        } else {
            return (methodId == ERC20_APPROVE);
        }
    }
}