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

import "../contracts/modules/common/SimpleOracle.sol";

contract TestSimpleOracle is SimpleOracle {

    bytes32 internal creationCode;

    constructor(address _uniswapRouter) SimpleOracle(_uniswapRouter) {
        address uniswapV2Factory = IUniswapV2Router01(_uniswapRouter).factory();
        (bool success, bytes memory _res) = uniswapV2Factory.staticcall(abi.encodeWithSignature("getKeccakOfPairCreationCode()"));
        if (success) {
            creationCode = abi.decode(_res, (bytes32));
        }
    }

    function ethToToken(address _token, uint256 _ethAmount) external view returns (uint256) {
        return inToken(_token, _ethAmount);
    }

    function getPairForSorted(address tokenA, address tokenB) internal override view returns (address pair) {
        pair = address(uint160(uint256(keccak256(abi.encodePacked(
                hex'ff',
                uniswapV2Factory,
                keccak256(abi.encodePacked(tokenA, tokenB)),
                creationCode
            )))));
    }
}