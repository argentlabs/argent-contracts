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

pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "../storage/GuardianStorage.sol";
import "../../lib/utils/SafeMath.sol";
import "../utils/GuardianUtils.sol";

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
    bytes4 constant internal EXECUTE_OWNERSHIP_TRANSFER_PREFIX = bytes4(keccak256("executeOwnershipTransfer(address,address)"));
    bytes4 constant internal FINALIZE_OWNERSHIP_TRANSFER_PREFIX = bytes4(keccak256("finalizeOwnershipTransfer(address)"));
    bytes4 constant internal CANCEL_OWNERSHIP_TRANSFER_PREFIX = bytes4(keccak256("cancelOwnershipTransfer(address)"));

    struct RecoveryConfig {
        address recovery;
        uint64 executeAfter;
        uint32 guardianCount;
    }

    struct OwnershipTransferConfig {
        address newOwner;
        uint64 executeAfter;
    }

    // the wallet specific storage
    mapping (address => RecoveryConfig) internal recoveryConfigs;
    mapping (address => OwnershipTransferConfig) internal ownershipTransferConfigs;

    // Recovery period
    uint256 public recoveryPeriod;
    // Lock period
    uint256 public lockPeriod;
    // The security period used for (non-recovery) ownership transfer
    uint256 public securityPeriod;
    // the security window used for (non-recovery) ownership transfer
    uint256 public securityWindow;
    // location of the Guardian storage
    GuardianStorage public guardianStorage;

    // *************** Events *************************** //

    event RecoveryExecuted(address indexed _wallet, address indexed _recovery, uint64 executeAfter);
    event RecoveryFinalized(address indexed _wallet, address indexed _recovery);
    event RecoveryCanceled(address indexed _wallet, address indexed _recovery);
    event OwnershipTransferExecuted(address indexed _wallet, address indexed _newOwner, uint64 executeAfter);
    event OwnershipTransferFinalized(address indexed _wallet, address indexed _newOwner);
    event OwnershipTransferCanceled(address indexed _wallet, address indexed _newOwner);

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

        /**
     * @dev Throws if there is no ongoing ownership transfer procedure.
     */
    modifier onlyWhenOwnershipTransfer(BaseWallet _wallet) {
        require(ownershipTransferConfigs[address(_wallet)].executeAfter > 0, "RM: there must be an ongoing ownership transfer");
        _;
    }

    /**
     * @dev Throws if there is an ongoing ownership transfer procedure.
     */
    modifier notWhenOwnershipTransfer(BaseWallet _wallet) {
        require(now > ownershipTransferConfigs[address(_wallet)].executeAfter + securityWindow,
            "RM: there cannot be an ongoing ownership transfer");
        _;
    }

    // *************** Constructor ************************ //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        uint256 _recoveryPeriod,
        uint256 _lockPeriod,
        uint256 _securityPeriod,
        uint256 _securityWindow
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        require(_lockPeriod >= _recoveryPeriod && _recoveryPeriod >= _securityPeriod + _securityWindow,
            "RM: insecure security periods");
        guardianStorage = _guardianStorage;
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
        _wallet.setOwner(config.recovery);
        emit RecoveryFinalized(address(_wallet), config.recovery);
        guardianStorage.setLock(_wallet, 0);
        delete recoveryConfigs[address(_wallet)];
    }

    /**
     * @dev Lets the owner cancel an ongoing recovery procedure.
     * Must be confirmed by N guardians, where N = ((Nb Guardian + 1) / 2) - 1.
     * @param _wallet The target wallet.
     */
    function cancelRecovery(BaseWallet _wallet) external onlyExecute onlyWhenRecovery(_wallet) {
        RecoveryConfig storage config = recoveryConfigs[address(_wallet)];
        emit  RecoveryCanceled(address(_wallet), config.recovery);
        guardianStorage.setLock(_wallet, 0);
        delete recoveryConfigs[address(_wallet)];
    }

    /**
    * @dev Gets the details of the ongoing recovery procedure if any.
    * @param _wallet The target wallet.
    */
    function getRecovery(BaseWallet _wallet) public view returns(address _address, uint64 _executeAfter, uint32 _guardianCount) {
        RecoveryConfig storage config = recoveryConfigs[address(_wallet)];
        return (config.recovery, config.executeAfter, config.guardianCount);
    }

    /**
     * @dev Lets the owner start the execution of the ownership transfer procedure.
     * Once triggered the ownership transfer is pending for the security period before it can
     * be finalised.
     * @param _wallet The target wallet.
     * @param _newOwner The address to which ownership should be transferred.
     */
    function executeOwnershipTransfer(
        BaseWallet _wallet,
        address _newOwner
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        notWhenOwnershipTransfer(_wallet)
    {
        require(_newOwner != address(0), "RM: new owner address cannot be null");
        OwnershipTransferConfig storage config = ownershipTransferConfigs[address(_wallet)];
        config.newOwner = _newOwner;
        config.executeAfter = uint64(now + securityPeriod);
        emit OwnershipTransferExecuted(address(_wallet), _newOwner, config.executeAfter);
    }

    /**
     * @dev Finalizes an ongoing ownership transfer procedure if the security period is over.
     * The method must be called during the confirmation window and
     * can be called by anyone to enable orchestration.
     * @param _wallet The target wallet.
     */
    function finalizeOwnershipTransfer(
        BaseWallet _wallet
    ) external
        onlyWhenUnlocked(_wallet)
        onlyWhenOwnershipTransfer(_wallet)
    {
        OwnershipTransferConfig storage config = ownershipTransferConfigs[address(_wallet)];
        require(config.executeAfter < now, "RM: Too early to confirm ownership transfer");
        require(now < config.executeAfter + securityWindow, "RM: Too late to confirm ownership transfer");
        _wallet.setOwner(config.newOwner);
        emit OwnershipTransferFinalized(address(_wallet), config.newOwner);
        delete ownershipTransferConfigs[address(_wallet)];
    }

    /**
     * @dev Lets the owner cancel an ongoing ownership transfer procedure.
     * @param _wallet The target wallet.
     */
    function cancelOwnershipTransfer(
        BaseWallet _wallet
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        onlyWhenOwnershipTransfer(_wallet)
    {
        OwnershipTransferConfig storage config = ownershipTransferConfigs[address(_wallet)];
        emit  OwnershipTransferCanceled(address(_wallet), config.newOwner);
        delete ownershipTransferConfigs[address(_wallet)];
    }

    // *************** Implementation of RelayerModule methods ********************* //

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory _data,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal view returns (bool)
    {
        address lastSigner = address(0);
        address[] memory guardians = guardianStorage.getGuardians(_wallet);
        bool isGuardian = false;
        for (uint8 i = 0; i < _signatures.length / 65; i++) {
            address signer = recoverSigner(_signHash, _signatures, i);
            if (i == 0 && isOwner(_wallet, signer)) {
                // first signer can be owner
                continue;
            } else {
                if (signer <= lastSigner) {
                    return false;
                } // "RM: signers must be different"
                lastSigner = signer;
                (isGuardian, guardians) = GuardianUtils.isGuardian(guardians, signer);
                if (!isGuardian) {
                    return false;
                } // "RM: signatures not valid"
            }
        }
        return true;
    }

    function getRequiredSignatures(BaseWallet _wallet, bytes memory _data) internal view returns (uint256) {
        bytes4 methodId = functionPrefix(_data);
        if (methodId == EXECUTE_RECOVERY_PREFIX) {
            return SafeMath.ceil(guardianStorage.guardianCount(_wallet) + 1, 2);
        }
        if (methodId == FINALIZE_RECOVERY_PREFIX) {
            return 0;
        }
        if (methodId == CANCEL_RECOVERY_PREFIX) {
            return SafeMath.ceil(recoveryConfigs[address(_wallet)].guardianCount + 1, 2);
        }
        if (methodId == EXECUTE_OWNERSHIP_TRANSFER_PREFIX) {
            return 1;
        }
        if (methodId == FINALIZE_OWNERSHIP_TRANSFER_PREFIX) {
            return 0;
        }
        if (methodId == CANCEL_OWNERSHIP_TRANSFER_PREFIX) {
            return 1;
        }
        revert("RM: unknown  method");
    }
}