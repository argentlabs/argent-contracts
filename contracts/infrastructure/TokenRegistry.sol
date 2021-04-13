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
pragma solidity ^0.8.3;

import "./ITokenRegistry.sol";
import "./base/Managed.sol";

/**
 * @title TokenRegistry
 * @notice Contract storing a list of tokens that can be safely traded.
 * @notice Only the owner can make a token tradable. Managers can make a token untradable.
 */
contract TokenRegistry is ITokenRegistry, Managed {

    // Tradable flag per token
    mapping(address => bool) public isTradable;

    function isTokenTradable(address _token) external override view returns (bool _isTradable) {
        _isTradable = isTradable[_token];
    }

    function areTokensTradable(address[] calldata _tokens) external override view returns (bool _areTradable) {
        for (uint256 i = 0; i < _tokens.length; i++) {
            if(!isTradable[_tokens[i]]) {
                return false;
            }
        }
        return true;
    }

    function getTradableForTokenList(address[] calldata _tokens) external view returns (bool[] memory _tradable) {
        _tradable = new bool[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tradable[i] = isTradable[_tokens[i]];
        }
    }

    function setTradableForTokenList(address[] calldata _tokens, bool[] calldata _tradable) external {
        require(_tokens.length == _tradable.length, "TR: Array length mismatch");
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(msg.sender == owner || (!_tradable[i] && managers[msg.sender]), "TR: Unauthorised");
            isTradable[_tokens[i]] = _tradable[i];
        }
    }
}