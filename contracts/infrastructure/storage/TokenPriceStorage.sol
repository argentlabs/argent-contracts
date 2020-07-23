// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity ^0.6.12;

import "./ITokenPriceStorage.sol";
import "./Storage.sol";
import "../base/Managed.sol";

/**
 * @title TokenPriceStorage
 * @notice Contract storing the token prices.
 * @notice Note that prices stored here = price per token * 10^(36-token decimals)
 * The contract only defines basic setters and getters with no logic.
 * Only managers of this contract can modify its state.
 */
contract TokenPriceStorage is ITokenPriceStorage, Storage, Managed {
    mapping(address => uint256) public cachedPrices;

    function getTokenPrice(address _token) external override view returns (uint256 _price) {
        _price = cachedPrices[_token];
    }

    function getPriceForTokenList(address[] calldata _tokens) external override view returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](_tokens.length);
        for (uint i = 0; i < _tokens.length; i++) {
            prices[i] = cachedPrices[_tokens[i]];
        }
        return prices;
    }

    function setPriceForTokenList(address[] calldata _tokens, uint256[] calldata _prices) external override onlyManager {
        for (uint16 i = 0; i < _tokens.length; i++) {
            cachedPrices[_tokens[i]] = _prices[i];
        }
    }

    function setPrice(address _token, uint256 _price) external override onlyManager {
        cachedPrices[_token] = _price;
    }
}