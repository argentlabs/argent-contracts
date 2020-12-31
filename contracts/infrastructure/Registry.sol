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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

import "./IRegistry.sol";
import "../base/Owned.sol";

/**
 * @title Registry implementation
 * @notice Used by the Proxy delegate to resolve registered function signatures against implementation contracts
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract Registry is IRegistry, Owned {
  mapping (bytes4 => address) public pointers;

  function register(string memory descriptor, address implementation) external
  onlyOwner
  {
    pointers[stringToSig(descriptor)] = implementation;
  }

  function lookup(bytes4 sig) external override view returns(address) {
    return pointers[sig];
  }

  function stringToSig(string memory descriptor) public pure returns(bytes4) {
    return bytes4(keccak256(abi.encodePacked(descriptor)));
  }
}