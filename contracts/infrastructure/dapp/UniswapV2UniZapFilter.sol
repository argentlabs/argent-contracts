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

contract UniswapV2UniZapFilter is BaseFilter {

    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 constant internal ADD_LIQUIDITY_WITH_ETH = bytes4(keccak256("swapExactETHAndAddLiquidity(address,uint256,address,uint256)"));
    bytes4 constant internal REMOVE_LIQUIDITY_TO_ETH = bytes4(keccak256("removeLiquidityAndSwapToETH(address,uint256,uint256,address,uint256)"));
    bytes4 constant internal ADD_LIQUIDITY_WITH_TOKEN = bytes4(
        keccak256(
            "swapExactTokensAndAddLiquidity(address,address,uint256,uint256,address,uint256)"
            )
        );
    bytes4 constant internal REMOVE_LIQUIDITY_TO_TOKEN = bytes4(
        keccak256(
            "removeLiquidityAndSwapToToken(address,address,uint256,uint256,address,uint256)"
            )
        );

    function isValid(address _wallet, address _spender, address _to, bytes calldata _data) external view override returns (bool) {
        // not needed but detects failure early
        if (_data.length < 4) {
            return false;
        }
        bytes4 method = getMethod(_data);
        // UniZap method: check that recipient is the wallet
        if (_spender == _to) {
            if (method == ADD_LIQUIDITY_WITH_TOKEN || method == REMOVE_LIQUIDITY_TO_TOKEN) {
                return (_wallet == abi.decode(_data[132:], (address)));
            }
            if (method == ADD_LIQUIDITY_WITH_ETH) {
                return (_wallet == abi.decode(_data[68:], (address)));
            }
            if (method == REMOVE_LIQUIDITY_TO_ETH) {
                return (_wallet == abi.decode(_data[100:], (address)));
            }
         // ERC20 methods
        } else {
            // only allow approve
            return (method == ERC20_APPROVE);
        }
    }
}