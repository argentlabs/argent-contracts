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

import "@uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol";
import "@uniswap/v2-periphery/contracts/libraries/UniswapV2Library.sol";
import "@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";


contract EmbeddedOracle {

    using FixedPoint for *;

    uint256 public constant PERIOD = 12 hours;

    struct TokenPrice {
        uint256 cumulative;
        FixedPoint.uq112x112 average;
    }

    address immutable weth;
    uint32 lastBlockTimestamp;
    address[] public tokens;
    
    mapping (address => IUniswapV2Pair) public pairs;
    mapping (address => TokenPrice) public lastPrice;

    constructor(address _factory, address _weth, address[] calldata _tokens) public {
        weth = _weth;
        tokens = _tokens;
        lastBlockTimestamp = UniswapV2OracleLibrary.currentBlockTimestamp();
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            IUniswapV2Pair pair = IUniswapV2Pair(UniswapV2Library.pairFor(_factory, _weth, token));
            (uint256 price0Cumulative, uint256 price1Cumulative, ) = UniswapV2OracleLibrary.currentCumulativePrices(address(pair));
            lastPrice[token].cumul = (_weth < token) ? price1Cumulative : price0Cumulative;
            pairs[token] = pair;
        }
    }

    function update() external {
        uint32 blockTimestamp = UniswapV2OracleLibrary.currentBlockTimestamp();
        uint32 timeElapsed = blockTimestamp - lastBlockTimestamp;
        require(timeElapsed >= PERIOD, "Oracle: period not elapsed");
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            (uint256 price0Cumulative, uint256 price1Cumulative,) = UniswapV2OracleLibrary.currentCumulativePrices(address(pairs[token]));
            uint256 cumulative = (weth < token) ? price1Cumulative : price0Cumulative;
            lastPrice[token].average = FixedPoint.uq112x112(uint224((cumulative - lastPrice[token].cumulative) / timeElapsed));
            lastPrice[token].cumulative = cumulative;
        }
    }

    function ethAmount(address _token, uint256 _amount) internal view returns (uint256) {
        FixedPoint.uq112x112 average = lastPrice[_token].average;
        require(average != FixedPoint.uq112x112(0), "EO: unkown token");
        return average.mul(_amount).decode144();
    }
}