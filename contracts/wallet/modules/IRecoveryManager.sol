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
 * @title IRecoveryManager
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface IRecoveryManager {
    event RecoveryExecuted(address indexed wallet, address indexed _recovery, uint64 executeAfter);
    event RecoveryFinalized(address indexed wallet, address indexed _recovery);
    event RecoveryCanceled(address indexed wallet, address indexed _recovery);
    event OwnershipTransfered(address indexed wallet, address indexed _newOwner);

    /**
     * @notice Lets the guardians start the execution of the recovery procedure.
     * Once triggered the recovery is pending for the security period before it can be finalised.
     * Must be confirmed by N guardians, where N = ((Nb Guardian + 1) / 2).
     * @param _recovery The address to which ownership should be transferred.
     */
    function executeRecovery(address _recovery) external;

    /**
     * @notice Finalizes an ongoing recovery procedure if the security period is over.
     * The method is public and callable by anyone to enable orchestration.
     */
    function finalizeRecovery() external;

    /**
     * @notice Lets the owner cancel an ongoing recovery procedure.
     * Must be confirmed by N guardians, where N = ((Nb Guardian + 1) / 2) - 1.
     */
    function cancelRecovery() external;

    /**
     * @notice Lets the owner transfer the wallet ownership. This is executed immediately.
     * @param _newOwner The address to which ownership should be transferred.
     */
    function transferOwnership(address _newOwner) external;

    /**
    * @notice Gets the details of the ongoing recovery procedure if any.
    */
    function getRecovery() external view returns(address _address, uint64 _executeAfter, uint32 _guardianCount);
}