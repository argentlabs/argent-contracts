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

import "../base/Utils.sol";
import "../base/BaseModule.sol";
import "../base/Configuration.sol";
import "./IRecoveryManager.sol";

/**
 * @title RecoveryManager
 * @notice Feature to manage the recovery of a wallet owner.
 * Recovery is executed by a consensus of the wallet's guardians and takes 24 hours before it can be finalized.
 * Once finalised the ownership of the wallet is transfered to a new address.
 * @author Julien Niset - <julien@argent.xyz>
 * @author Olivier Van Den Biggelaar - <olivier@argent.xyz>
 */
contract RecoveryManager is IRecoveryManager, BaseModule {
    // *************** Modifiers ************************ //

    /**
     * @notice Throws if there is no ongoing recovery procedure.
     */
    modifier onlyWhenRecovery() {
        require(recoveryConfig.executeAfter > 0, "RM: there must be an ongoing recovery");
        _;
    }

    /**
     * @notice Throws if there is an ongoing recovery procedure.
     */
    modifier notWhenRecovery() {
        require(recoveryConfig.executeAfter == 0, "RM: there cannot be an ongoing recovery");
        _;
    }

    modifier validateNewOwner(address _newOwner) {
        require(_newOwner != address(0), "RM: new owner address cannot be null");
        require(!isGuardian(_newOwner), "RM: new owner address cannot be a guardian");
        _;
    }

    // *************** External functions ************************ //

    /**
     * @inheritdoc IRecoveryManager
     */
    function executeRecovery(address _recovery) external override
    onlyWallet()
    notWhenRecovery()
    validateNewOwner(_recovery)
    {
        recoveryConfig.recovery = _recovery;
        recoveryConfig.executeAfter = uint64(block.timestamp + Configuration(registry).recoveryPeriod());
        recoveryConfig.guardianCount = uint32(guardiansCount);
        setLock(block.timestamp + Configuration(registry).lockPeriod());
        emit RecoveryExecuted(address(this), _recovery, recoveryConfig.executeAfter);
    }

    /**
     * @inheritdoc IRecoveryManager
     */
    function finalizeRecovery() external override
    onlyWhenRecovery() 
    {
        require(uint64(block.timestamp) > recoveryConfig.executeAfter, "RM: the recovery period is not over yet");
        address recoveryOwner = recoveryConfig.recovery;
        delete recoveryConfig;

        owner = recoveryOwner;
        setLock(0);

        emit RecoveryFinalized(address(this), recoveryOwner);
    }

    /**
     * @inheritdoc IRecoveryManager
     */
    function cancelRecovery() external override
    onlyWallet()
    onlyWhenRecovery()
    {
        address recoveryOwner = recoveryConfig.recovery;
        delete recoveryConfig;
        setLock(0);

        emit RecoveryCanceled(address(this), recoveryOwner);
    }

    /**
     * @inheritdoc IRecoveryManager
     */
    function transferOwnership(address _newOwner) external override
    onlyWallet()
    onlyWhenUnlocked()
    validateNewOwner(_newOwner)
    {
        owner = _newOwner;

        emit OwnershipTransfered(address(this), _newOwner);
    }

    /**
     * @inheritdoc IRecoveryManager
     */
    function getRecovery() external override view returns(address _address, uint64 _executeAfter, uint32 _guardianCount) {
        return (recoveryConfig.recovery, recoveryConfig.executeAfter, recoveryConfig.guardianCount);
    }

    /**
     * @dev Set the lock for a wallet.
     * @param _releaseAfter The epoch time at which the lock should automatically release.
     */
    function setLock(uint256 _releaseAfter) private {
        walletLock.releaseAfter = _releaseAfter;
        if (_releaseAfter != 0 && walletLock.module != LockModule.RecoveryManager) {
            walletLock.module = LockModule.RecoveryManager;
        }
    }
}