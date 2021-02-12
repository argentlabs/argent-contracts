// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

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

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract SimpleOracle {

    using SafeMath for uint256;

    address immutable weth;
    address immutable factory;

    constructor(address _factory, address _weth) public {
        weth = _weth;
        factory = _factory;
    }

    function ethAmount(address _token, uint256 _tokenAmount) internal view returns (uint256) {
        (uint112 wethReserve, uint112 tokenReserve) = getReservesForTokenPool(_token);
        return _tokenAmount.mul(wethReserve) / tokenReserve;
    }

    function tokenAmount(address _token, uint256 _ethAmount) internal view returns (uint256) {
        (uint112 wethReserve, uint112 tokenReserve) = getReservesForTokenPool(_token);
        return _ethAmount.mul(tokenReserve) / wethReserve;
    }

    function getReservesForTokenPool(address _token) internal view returns (uint112 wethReserve, uint112 tokenReserve) {
        if (weth < _token) {
            address pair = getPairForSorted(weth, _token);
            (wethReserve, tokenReserve,) = IUniswapV2Pair(pair).getReserves();
        } else {
            address pair = getPairForSorted(_token, weth);
            (tokenReserve, wethReserve,) = IUniswapV2Pair(pair).getReserves();
        }
        require(wethReserve != 0 && tokenReserve != 0, "SO: no liquidity");
    }

    function getPairForSorted(address tokenA, address tokenB) internal view returns (address pair) {
        pair = address(uint(keccak256(abi.encodePacked(
                hex'ff',
                factory,
                keccak256(abi.encodePacked(tokenA, tokenB)),
                hex'96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f' // init code hash
            ))));
    }
}