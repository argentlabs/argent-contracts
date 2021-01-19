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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

interface IGuardianManager {

    event GuardianAdditionRequested(address indexed wallet, address indexed guardian, uint256 executeAfter);
    event GuardianRevokationRequested(address indexed wallet, address indexed guardian, uint256 executeAfter);
    event GuardianAdditionCancelled(address indexed wallet, address indexed guardian);
    event GuardianRevokationCancelled(address indexed wallet, address indexed guardian);
    event GuardianAdded(address indexed wallet, address indexed guardian);
    event GuardianRevoked(address indexed wallet, address indexed guardian);

    /**
     * @notice Lets the owner add a guardian to its wallet.
     * The first guardian is added immediately. All following additions must be confirmed
     * by calling the confirmGuardianAddition() method.
     * @param _guardian The guardian to add.
     */
    function addGuardian(address _guardian) external;

    /**
     * @notice Confirms the pending addition of a guardian to a wallet.
     * The method must be called during the confirmation window and can be called by anyone to enable orchestration.
     * @param _guardian The guardian.
     */
    function confirmGuardianAddition(address _guardian) external;

    /**
     * @notice Lets the owner cancel a pending guardian addition.
     * @param _guardian The guardian.
     */
    function cancelGuardianAddition(address _guardian) external;

    /**
     * @notice Lets an authorised module revoke a guardian from a wallet.
     * @dev Revokation must be confirmed by calling the confirmGuardianRevokation() method.
     * @param _guardian The guardian to revoke.
     */
    function revokeGuardian(address _guardian) external;

    /**
     * @notice Confirms the pending revokation of a guardian to a wallet.
     * The method must be called during the confirmation window and can be called by anyone to enable orchestration.
     * @param _guardian The guardian.
     */
    function confirmGuardianRevokation(address _guardian) external;

    /**
     * @notice Lets the owner cancel a pending guardian revokation.
     * @param _guardian The guardian.
     */
    function cancelGuardianRevokation(address _guardian) external;

    /**
     * @notice Get the active guardians for a wallet.
     * @return _guardians the active guardians for a wallet.
     */
    function getGuardians() external view returns (address[] memory);
}