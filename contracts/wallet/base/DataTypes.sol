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

/**
 * @title DataTypes interface for Argent specific struct, enum, constant and event definitions in a wallet.
 * @notice 
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract DataTypes {
    // Empty calldata
    bytes constant internal EMPTY_BYTES = "";
    // Mock token address for ETH
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // large limit when the limit can be considered disabled
    uint128 constant internal LIMIT_DISABLED = uint128(-1);

    enum ActionType { Transfer }

    enum LockModule { RecoveryManager, LockManager }

    enum OwnerSignature {
        None,              // Anyone
        Required,          // Owner required
        Optional,          // Owner and/or guardians
        Disallowed         // guardians only
    }

    enum GuardianSignature {
        None,              // Anyone
        One,               // Exactly one guardian
        Majority,          // ceil(gs/2)
        MajorityIncOwner   // ceil(gs+1/2)
    }

    struct RelaySignatures {
        OwnerSignature ownerSignatureRequirement;
        GuardianSignature guardianSignatureRequirement;
    }

    struct GuardianInfo {
        bool exists;
        uint128 index;
    }

    struct Lock {
        // The type of lock placed, i.e. which module set the lock
        LockModule module;
        // The lock's release timestamp
        uint256 releaseAfter;
    }

    struct Limit {
        // the current limit
        uint128 current;
        // the pending limit if any
        uint128 pending;
        // when the pending limit becomes the current limit
        uint64 changeAfter;
    }

    struct DailySpent {
        // The amount already spent during the current period
        uint128 alreadySpent;
        // The end of the current period
        uint64 periodEnd;
    }

    struct RecoveryConfig {
        address recovery;
        uint64 executeAfter;
        uint32 guardianCount;
    }
}
