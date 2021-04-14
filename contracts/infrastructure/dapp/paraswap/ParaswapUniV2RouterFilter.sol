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

contract ParaswapUniV2RouterFilter is BaseFilter {

    bytes4 private constant SWAP = bytes4(keccak256("swap(uint256,uint256,address[])"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    // The token registry
    address public immutable tokenRegistry;
    // The UniV2 factory
    address public immutable factory;
    // The UniV2 initCode
    bytes32 public immutable initCode;
    // The WETH address
    address public immutable weth;

    constructor(address _tokenRegistry, address _factory, bytes32 _initCode, address _weth) {
        tokenRegistry = _tokenRegistry;
        factory = _factory;
        initCode = _initCode;
        weth = _weth;
    }

    function isValid(address /*_wallet*/, address /*_spender*/, address /*_to*/, bytes calldata _data) external view override returns (bool valid) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }

        bytes4 methodId = getMethod(_data);

        if(methodId == SWAP) {
            (, address[] memory path) = abi.decode(_data[4:], (uint256[2], address[]));
            return ParaswapUtils.hasValidUniV2Path(path, tokenRegistry, factory, initCode, weth);
        } 
        
        return methodId == ERC20_APPROVE;
    }
}