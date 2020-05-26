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
pragma solidity ^0.6.8;

import "./common/ArgentSafeMath.sol";
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./storage/GuardianStorage.sol";

/**
 * @title RecoveryManager
 * @dev Module to manage the recovery of a wallet owner.
 * Recovery is executed by a consensus of the wallet's guardians and takes
 * 24 hours before it can be finalized. Once finalised the ownership of the wallet
 * is transfered to a new address.
 * @author Julien Niset - <julien@argent.im>
 * @author Olivier Van Den Biggelaar - <olivier@argent.im>
 */
contract RecoveryManager is BaseModule, RelayerModule {

    bytes32 constant NAME = "RecoveryManager";

    bytes4 constant internal EXECUTE_RECOVERY_PREFIX = bytes4(keccak256("executeRecovery(address,address)"));
    bytes4 constant internal FINALIZE_RECOVERY_PREFIX = bytes4(keccak256("finalizeRecovery(address)"));
    bytes4 constant internal CANCEL_RECOVERY_PREFIX = bytes4(keccak256("cancelRecovery(address)"));
    bytes4 constant internal TRANSFER_OWNERSHIP_PREFIX = bytes4(keccak256("transferOwnership(address,address)"));

    struct RecoveryConfig {
        address recovery;
        uint64 executeAfter;
        uint32 guardianCount;
    }

    // Wallet specific storage
    mapping (address => RecoveryConfig) internal recoveryConfigs;

    // Recovery period
    uint256 public recoveryPeriod;
    // Lock period
    uint256 public lockPeriod;
    // Security period used for (non-recovery) ownership transfer
    uint256 public securityPeriod;
    // Security window used for (non-recovery) ownership transfer
    uint256 public securityWindow;

    // *************** Events *************************** //

    event RecoveryExecuted(address indexed wallet, address indexed _recovery, uint64 executeAfter);
    event RecoveryFinalized(address indexed wallet, address indexed _recovery);
    event RecoveryCanceled(address indexed wallet, address indexed _recovery);
    event OwnershipTransfered(address indexed wallet, address indexed _newOwner);

    // *************** Modifiers ************************ //

    /**
     * @dev Throws if there is no ongoing recovery procedure.
     */
    modifier onlyWhenRecovery(BaseWallet _wallet) {
        require(recoveryConfigs[address(_wallet)].executeAfter > 0, "RM: there must be an ongoing recovery");
        _;
    }

    /**
     * @dev Throws if there is an ongoing recovery procedure.
     */
    modifier notWhenRecovery(BaseWallet _wallet) {
        require(recoveryConfigs[address(_wallet)].executeAfter == 0, "RM: there cannot be an ongoing recovery");
        _;
    }

    // *************** Constructor ************************ //

    constructor(
        IModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        uint256 _recoveryPeriod,
        uint256 _lockPeriod,
        uint256 _securityPeriod,
        uint256 _securityWindow
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        require(_lockPeriod >= _recoveryPeriod && _recoveryPeriod >= _securityPeriod + _securityWindow, "RM: insecure security periods");
        recoveryPeriod = _recoveryPeriod;
        lockPeriod = _lockPeriod;
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
    }

    // *************** External functions ************************ //

    /**
     * @dev Lets the guardians start the execution of the recovery procedure.
     * Once triggered the recovery is pending for the security period before it can
     * be finalised.
     * Must be confirmed by N guardians, where N = ((Nb Guardian + 1) / 2).
     * @param _wallet The target wallet.
     * @param _recovery The address to which ownership should be transferred.
     */
    function executeRecovery(BaseWallet _wallet, address _recovery) external onlyExecute notWhenRecovery(_wallet) {
        require(_recovery != address(0), "RM: recovery address cannot be null");
        RecoveryConfig storage config = recoveryConfigs[address(_wallet)];
        config.recovery = _recovery;
        config.executeAfter = uint64(now + recoveryPeriod);
        config.guardianCount = uint32(guardianStorage.guardianCount(_wallet));
        guardianStorage.setLock(_wallet, now + lockPeriod);
        emit RecoveryExecuted(address(_wallet), _recovery, config.executeAfter);
    }

    /**
     * @dev Finalizes an ongoing recovery procedure if the security period is over.
     * The method is public and callable by anyone to enable orchestration.
     * @param _wallet The target wallet.
     */
    function finalizeRecovery(BaseWallet _wallet) external onlyWhenRecovery(_wallet) {
        RecoveryConfig storage config = recoveryConfigs[address(_wallet)];
        require(uint64(now) > config.executeAfter, "RM: the recovery period is not over yet");
        address recoveryOwner = config.recovery;
        delete recoveryConfigs[address(_wallet)];

        _wallet.setOwner(recoveryOwner);
        guardianStorage.setLock(_wallet, 0);

        emit RecoveryFinalized(address(_wallet), recoveryOwner);
    }

    /**
     * @dev Lets the owner cancel an ongoing recovery procedure.
     * Must be confirmed by N guardians, where N = ((Nb Guardian + 1) / 2) - 1.
     * @param _wallet The target wallet.
     */
    function cancelRecovery(BaseWallet _wallet) external onlyExecute onlyWhenRecovery(_wallet) {
        RecoveryConfig storage config = recoveryConfigs[address(_wallet)];
        address recoveryOwner = config.recovery;
        delete recoveryConfigs[address(_wallet)];
        guardianStorage.setLock(_wallet, 0);

        emit RecoveryCanceled(address(_wallet), recoveryOwner);
    }

    /**
     * @dev Lets the owner start the execution of the ownership transfer procedure.
     * Once triggered the ownership transfer is pending for the security period before it can
     * be finalised.
     * @param _wallet The target wallet.
     * @param _newOwner The address to which ownership should be transferred.
     */
    function transferOwnership(BaseWallet _wallet, address _newOwner) external onlyExecute onlyWhenUnlocked(_wallet) {
        require(_newOwner != address(0), "RM: new owner address cannot be null");
        _wallet.setOwner(_newOwner);

        emit OwnershipTransfered(address(_wallet), _newOwner);
    }

    /**
    * @dev Gets the details of the ongoing recovery procedure if any.
    * @param _wallet The target wallet.
    */
    function getRecovery(BaseWallet _wallet) external view returns(address _address, uint64 _executeAfter, uint32 _guardianCount) {
        RecoveryConfig storage config = recoveryConfigs[address(_wallet)];
        return (config.recovery, config.executeAfter, config.guardianCount);
    }

    // *************** Implementation of RelayerModule methods ********************* //

    function getRequiredSignatures(BaseWallet _wallet, bytes memory _data) public view returns (uint256, OwnerSignature) {
        bytes4 methodId = functionPrefix(_data);
        if (methodId == EXECUTE_RECOVERY_PREFIX) {
            uint numberOfSignaturesRequired = ArgentSafeMath.ceil(guardianStorage.guardianCount(_wallet), 2);
            return (numberOfSignaturesRequired, OwnerSignature.Disallowed);
        }
        if (methodId == FINALIZE_RECOVERY_PREFIX) {
            return (0, OwnerSignature.Required);
        }
        if (methodId == CANCEL_RECOVERY_PREFIX) {
            uint numberOfSignaturesRequired = ArgentSafeMath.ceil(recoveryConfigs[address(_wallet)].guardianCount + 1, 2);
            return (numberOfSignaturesRequired, OwnerSignature.Optional);
        }
        if (methodId == TRANSFER_OWNERSHIP_PREFIX) {
            uint majorityGuardians = ArgentSafeMath.ceil(guardianStorage.guardianCount(_wallet), 2);
            uint numberOfSignaturesRequired = SafeMath.add(majorityGuardians, 1);
            return (numberOfSignaturesRequired, OwnerSignature.Required);
        }

        revert("RM: unknown method");
    }
}