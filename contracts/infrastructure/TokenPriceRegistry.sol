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

import "./ITokenPriceRegistry.sol";
import "./base/Managed.sol";

/**
 * @title TokenPriceRegistry
 * @notice Contract storing the token prices.
 * @notice Note that prices stored here = price per token * 10^(18-token decimals)
 * The contract only defines basic setters and getters with no logic.
 * Only managers of this contract can modify its state.
 */
contract TokenPriceRegistry is ITokenPriceRegistry, Managed {
    struct TokenInfo {
        uint184 cachedPrice;
        uint64 updatedAt;
        bool isTradable;
    }

    // Price info per token
    mapping(address => TokenInfo) public tokenInfo;
    // The minimum period between two price updates
    uint256 public minPriceUpdatePeriod;


    // Getters

    function getTokenPrice(address _token) external override view returns (uint184 _price) {
        _price = tokenInfo[_token].cachedPrice;
    }
    function isTokenTradable(address _token) external override view returns (bool _isTradable) {
        _isTradable = tokenInfo[_token].isTradable;
    }
    function getPriceForTokenList(address[] calldata _tokens) external view returns (uint184[] memory _prices) {
        _prices = new uint184[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            _prices[i] = tokenInfo[_tokens[i]].cachedPrice;
        }
    }
    function getTradableForTokenList(address[] calldata _tokens) external view returns (bool[] memory _tradable) {
        _tradable = new bool[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tradable[i] = tokenInfo[_tokens[i]].isTradable;
        }
    }

    // Setters
    
    function setMinPriceUpdatePeriod(uint256 _newPeriod) external onlyOwner {
        minPriceUpdatePeriod = _newPeriod;
    }
    function setPriceForTokenList(address[] calldata _tokens, uint184[] calldata _prices) external onlyManager {
        require(_tokens.length == _prices.length, "TPS: Array length mismatch");
        for (uint i = 0; i < _tokens.length; i++) {
            uint64 updatedAt = tokenInfo[_tokens[i]].updatedAt;
            require(updatedAt == 0 || block.timestamp >= updatedAt + minPriceUpdatePeriod, "TPS: Price updated too early");
            tokenInfo[_tokens[i]].cachedPrice = _prices[i];
            tokenInfo[_tokens[i]].updatedAt = uint64(block.timestamp);
        }
    }
    function setTradableForTokenList(address[] calldata _tokens, bool[] calldata _tradable) external {
        require(_tokens.length == _tradable.length, "TPS: Array length mismatch");
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(msg.sender == owner || (!_tradable[i] && managers[msg.sender]), "TPS: Unauthorised");
            tokenInfo[_tokens[i]].isTradable = _tradable[i];
        }
    }
}