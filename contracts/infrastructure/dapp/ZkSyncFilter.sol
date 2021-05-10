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
 * @title ZkSyncFilter
 * @notice Filter used for deposits & withdrawals from ZkSync L2
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract ZkSyncFilter is BaseFilter {

    bytes4 private constant DEPOSIT_ETH = bytes4(keccak256("depositETH(address)"));
    bytes4 private constant DEPOSIT_ERC20 = bytes4(keccak256("depositERC20(address,uint104,address)"));
    bytes4 private constant WITHDRAW = bytes4(keccak256("withdrawPendingBalance(address,address,uint128)"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    function isValid(address /*_wallet*/, address _spender, address _to, bytes calldata _data) external view override returns (bool valid) {
        if (_data.length == 0) {
            return false;
        }
        
        if (_data.length >= 4) {
            bytes4 methodId = getMethod(_data);
            if(_spender != _to) {
                return methodId == ERC20_APPROVE;
            }
            return (methodId == DEPOSIT_ETH || methodId == DEPOSIT_ERC20 || methodId == WITHDRAW);
        }
    }
}