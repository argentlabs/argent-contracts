// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.s

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "./IFilter.sol";

contract AaveV2Filter is IFilter {

    bytes4 private constant DEPOSIT = bytes4(keccak256("deposit(address,uint256,address,uint16)"));
    bytes4 private constant WITHDRAW = bytes4(keccak256("withdraw(address,uint256,address)"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    function isValid(address _wallet, address _spender, address _to, bytes calldata _data) external view override returns (bool) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }
        bytes4 method = getMethod(_data);
        // LendingPool methods
        if (_spender == _to) {
            // only allow deposits and withdrawals with wallet as beneficiary
            if(method == DEPOSIT || method == WITHDRAW) {
                (,, address beneficiary) = abi.decode(_data[4:], (address, uint256, address));   
                return beneficiary == _wallet;
            }
            return false;
        // ERC20 methods
        } else {
            // only allow approve
            return (method == ERC20_APPROVE);
        }
    }

    function getMethod(bytes memory _data) internal pure returns (bytes4 method) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            method := mload(add(_data, 0x20))
        }
    }
}