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

import "../../infrastructure/base/Owned.sol";
import "./DataTypes.sol";

/**
 * @title WalletStorage
 * @notice Storage properties for a wallet are consolidated here for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract WalletStorage is DataTypes, Owned {
    // address public owner; from Owned - storage slot 0
    address public registry; // from DelegateProxy - storage slot 1

    // The address of the WETH token
    address public wethToken;

    // the lock's release timestamp
    uint256 public lock;
    // the module that set the last lock
    address public locker;

    // Limit struct
    // the current limit
    uint128 public current;
    // the pending limit if any
    uint128 public pending;
    // when the pending limit becomes the current limit
    uint64 public changeAfter;

    // DailySpent struct
    // The amount already spent during the current period
    uint128 public alreadySpent;
    // The end of the current period
    uint64 public periodEnd;

    // the list of guardians
    address[] public guardians;
    // the info about guardians
    mapping (address => GuardianInfo) public info;
    // the lock's release timestamp
    uint256 public lockRelease;
    // the module that set the last lock
    address public locker;
    // The lock period
    uint256 public lockPeriod;
    // The time at which a guardian addition or revokation will be confirmable by the owner
    mapping (bytes32 => uint256) public pending;

    // The security period
    uint256 public securityPeriod;
    // The security window
    uint256 public securityWindow;

    mapping (address => uint256) internal whitelist;
}