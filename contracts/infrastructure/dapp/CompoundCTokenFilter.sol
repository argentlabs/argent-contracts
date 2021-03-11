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

import "./BaseFilter.sol";

contract CompoundCTokenFilter is BaseFilter {

    bytes4 private constant CTOKEN_REPAY_BORROW_BEHALF = bytes4(keccak256("repayBorrowBehalf(address,uint256)"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    address public immutable underlying;

    constructor (address _underlying) public {
        underlying = _underlying;
    }

    function isValid(address /*_wallet*/, address _spender, address _to, bytes calldata _data) external view override returns (bool) {
        // disable ETH transfer for cErc20
        if (_data.length < 4) {
            return (_data.length == 0) && (underlying == address(0));
        }
        bytes4 method = getMethod(_data);
        // cToken methods
        if (_spender == _to) {
            // block repayBorrowBehalf
            return (method != CTOKEN_REPAY_BORROW_BEHALF);
        // ERC20 methods
        } else {
            // only allow an approve on the underlying 
            return (method == ERC20_APPROVE && underlying == _to);
        }
    }
}