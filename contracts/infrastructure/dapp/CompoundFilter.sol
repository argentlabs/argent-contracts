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

contract CompoundFilter is IFilter {

    bytes4 private constant CETH_MINT = bytes4(keccak256("mint()"));
    bytes4 private constant CERC20_MINT = bytes4(keccak256("mint(uint256)"));
    bytes4 private constant CTOKEN_REDEEM = bytes4(keccak256("redeem(uint256)"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    function isValid(address _wallet, address _spender, address _to, bytes calldata _data) external view override returns (bool) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }
        bytes4 method = getMethod(_data);
        // only mint or redeem on a cToken (cEth and cErc20)
        if (_spender == _to) {
            return (method == CETH_MINT || method == CERC20_MINT || method == CTOKEN_REDEEM);
        // only approve on the underlying when cErc20 is spender
        } else if (method == ERC20_APPROVE) {
            (bool success, bytes memory data) = _spender.staticcall(abi.encodeWithSignature("underlying()"));
            return success && (abi.decode(data, (address)) == _to);
        }
        return false;
    }

    function getMethod(bytes memory _data) internal pure returns (bytes4 method) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            method := mload(add(_data, 0x20))
        }
    }
}