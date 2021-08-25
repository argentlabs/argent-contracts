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

import "./BaseFilter.sol";

/**
 * @title ArgentEnsManagerFilter
 * @notice Filter used to register a <label>.argent.xyz ENS with the Argent ENS Manager at 0xF32FDDEF964b98b1d2d2b1C071ac60ED55d4D217.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract ArgentEnsManagerFilter is BaseFilter {

  bytes4 private constant REGISTER = bytes4(keccak256("register(string,address,bytes)"));

  function isValid(address /*_wallet*/, address _spender, address _to, bytes calldata _data) external pure override returns (bool valid) {
    // disable ETH transfer
    if (_data.length < 4) {
        return false;
    }

    bytes4 methodId = getMethod(_data);
    return _spender == _to && methodId == REGISTER;
  }
}