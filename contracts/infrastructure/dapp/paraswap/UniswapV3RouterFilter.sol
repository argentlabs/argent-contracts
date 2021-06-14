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
 * @title UniswapV3RouterFilter
 * @notice Filter used for calls to UniswapV3 router (aka "SwapRouter").
    SwapRouter is deployed at 0xE592427A0AEce92De3Edee1F18E0157C05861564
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract UniswapV3RouterFilter is BaseFilter {

    bytes4 private constant SELL_SINGLE = bytes4(keccak256("exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))"));
    bytes4 private constant ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));

    // The token registry
    address public immutable tokenRegistry;
    // The UniV3 factory
    address public immutable factory;
    // The UniV3 pool initCode
    bytes32 public immutable initCode;
    // The WETH address
    address public immutable weth;

    constructor(address _tokenRegistry, address _factory, bytes32 _initCode, address _weth) {
        tokenRegistry = _tokenRegistry;
        factory = _factory;
        initCode = _initCode;
        weth = _weth;
    }

    function isValid(address _wallet, address _spender, address _to, bytes calldata _data) external view override returns (bool valid) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }

        bytes4 methodId = getMethod(_data);

        if(methodId == SELL_SINGLE) {
            (address tokenFrom, address tokenTo, uint24 fee, address recipient) = abi.decode(_data[4:], (address, address, uint24, address));
            return ParaswapUtils.hasValidUniV3Pool(tokenFrom, tokenTo, fee, tokenRegistry, factory, initCode, weth) && recipient == _wallet;
        } 
        
        return methodId == ERC20_APPROVE && _spender != _to;
    }
}