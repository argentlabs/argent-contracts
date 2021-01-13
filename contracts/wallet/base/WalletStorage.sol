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
import "./Configuration.sol";
import "./DataTypes.sol";

/**
 * @title WalletStorage
 * @notice Storage properties for a wallet are consolidated here for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract WalletStorage is DataTypes, Owned {
    // address public owner; from Owned - storage slot 0
    Configuration public registry; // from DelegateProxy - storage slot 1

    // the list of guardians
    address[] public guardians;
    // the info about guardians
    mapping (address => GuardianInfo) public info;

    Limit public limit;

    DailySpent public dailySpent;

    Lock public walletLock;

    // The time at which a guardian addition or revokation will be confirmable by the owner
    mapping (bytes32 => uint256) public pending;

    mapping (address => uint256) internal whitelist;

    // Mapping between pending action hash and their timestamp
    mapping (bytes32 => uint256) public pendingActions;

    RecoveryConfig internal recoveryConfig;

    // Mapping [ilk] -> loanId, that keeps track of cdp owners
    // while also enforcing a maximum of one loan per token (ilk) and per wallet
    // (which will make future upgrades of the module easier)
    mapping(bytes32 => bytes32) public loanIds;

    // Lock used by MakerV2Loan.nonReentrant()
    bool private _notEntered = true;
}