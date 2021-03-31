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
pragma solidity ^0.8.3;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./common/Utils.sol";
import "./common/BaseModule.sol";
import "../wallet/IWallet.sol";

/**
 * @title SecurityManager
 * @notice Abstract module implementing the key security features of the wallet: guardians, lock and recovery.
 * @author Julien Niset - <julien@argent.xyz>
 * @author Olivier Van Den Biggelaar - <olivier@argent.xyz>
 */
abstract contract SecurityManager is BaseModule {

    struct RecoveryConfig {
        address recovery;
        uint64 executeAfter;
        uint32 guardianCount;
    }

    struct GuardianManagerConfig {
        // The time at which a guardian addition or revokation will be confirmable by the owner
        mapping (bytes32 => uint256) pending;
    }

    // Wallet specific storage for recovery
    mapping (address => RecoveryConfig) internal recoveryConfigs;
    // Wallet specific storage for pending guardian addition/revokation
    mapping (address => GuardianManagerConfig) internal guardianConfigs;


    // Recovery period
    uint256 internal immutable recoveryPeriod;
    // Lock period
    uint256 internal immutable lockPeriod;
    // The security period to add/remove guardians
    uint256 internal immutable securityPeriod;
    // The security window
    uint256 internal immutable securityWindow;

    // *************** Events *************************** //

    event RecoveryExecuted(address indexed wallet, address indexed _recovery, uint64 executeAfter);
    event RecoveryFinalized(address indexed wallet, address indexed _recovery);
    event RecoveryCanceled(address indexed wallet, address indexed _recovery);
    event OwnershipTransfered(address indexed wallet, address indexed _newOwner);
    event Locked(address indexed wallet, uint64 releaseAfter);
    event Unlocked(address indexed wallet);
    event GuardianAdditionRequested(address indexed wallet, address indexed guardian, uint256 executeAfter);
    event GuardianRevokationRequested(address indexed wallet, address indexed guardian, uint256 executeAfter);
    event GuardianAdditionCancelled(address indexed wallet, address indexed guardian);
    event GuardianRevokationCancelled(address indexed wallet, address indexed guardian);
    event GuardianAdded(address indexed wallet, address indexed guardian);
    event GuardianRevoked(address indexed wallet, address indexed guardian);
    // *************** Modifiers ************************ //

    /**
     * @notice Throws if there is no ongoing recovery procedure.
     */
    modifier onlyWhenRecovery(address _wallet) {
        require(recoveryConfigs[_wallet].executeAfter > 0, "SM: no ongoing recovery");
        _;
    }

    /**
     * @notice Throws if there is an ongoing recovery procedure.
     */
    modifier notWhenRecovery(address _wallet) {
        require(recoveryConfigs[_wallet].executeAfter == 0, "SM: ongoing recovery");
        _;
    }

    /**
     * @notice Throws if the caller is not a guardian for the wallet or the module itself.
     */
    modifier onlyGuardianOrSelf(address _wallet) {
        require(_isSelf(msg.sender) || isGuardian(_wallet, msg.sender), "SM: must be guardian/self");
        _;
    }

    // *************** Constructor ************************ //

    constructor(
        uint256 _recoveryPeriod,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint256 _lockPeriod
    ) {
        // For the wallet to be secure we must have recoveryPeriod >= securityPeriod + securityWindow
        // where securityPeriod and securityWindow are the security parameters of adding/removing guardians.
        require(_lockPeriod >= _recoveryPeriod, "SM: insecure lock period");
        require(_recoveryPeriod >= _securityPeriod + _securityWindow, "SM: insecure security periods");
        recoveryPeriod = _recoveryPeriod;
        lockPeriod = _lockPeriod;
        securityWindow = _securityWindow;
        securityPeriod = _securityPeriod;
    }

    // *************** External functions ************************ //

    // *************** Recovery functions ************************ //

    /**
     * @notice Lets the guardians start the execution of the recovery procedure.
     * Once triggered the recovery is pending for the security period before it can be finalised.
     * Must be confirmed by N guardians, where N = ceil(Nb Guardians / 2).
     * @param _wallet The target wallet.
     * @param _recovery The address to which ownership should be transferred.
     */
    function executeRecovery(address _wallet, address _recovery) external onlySelf() notWhenRecovery(_wallet) {
        validateNewOwner(_wallet, _recovery);
        uint64 executeAfter = uint64(block.timestamp + recoveryPeriod);
        recoveryConfigs[_wallet] = RecoveryConfig(_recovery, executeAfter, uint32(guardianStorage.guardianCount(_wallet)));
        _setLock(_wallet, block.timestamp + lockPeriod, SecurityManager.executeRecovery.selector);
        emit RecoveryExecuted(_wallet, _recovery, executeAfter);
    }

    /**
     * @notice Finalizes an ongoing recovery procedure if the security period is over.
     * The method is public and callable by anyone to enable orchestration.
     * @param _wallet The target wallet.
     */
    function finalizeRecovery(address _wallet) external onlyWhenRecovery(_wallet) {
        RecoveryConfig storage config = recoveryConfigs[_wallet];
        require(uint64(block.timestamp) > config.executeAfter, "SM: ongoing recovery period");
        address recoveryOwner = config.recovery;
        delete recoveryConfigs[_wallet];

        _clearSession(_wallet);

        IWallet(_wallet).setOwner(recoveryOwner);
        _setLock(_wallet, 0, bytes4(0));

        emit RecoveryFinalized(_wallet, recoveryOwner);
    }

    /**
     * @notice Lets the owner cancel an ongoing recovery procedure.
     * Must be confirmed by N guardians, where N = ceil(Nb Guardian at executeRecovery + 1) / 2) - 1.
     * @param _wallet The target wallet.
     */
    function cancelRecovery(address _wallet) external onlySelf() onlyWhenRecovery(_wallet) {
        address recoveryOwner = recoveryConfigs[_wallet].recovery;
        delete recoveryConfigs[_wallet];
        _setLock(_wallet, 0, bytes4(0));

        emit RecoveryCanceled(_wallet, recoveryOwner);
    }

    /**
     * @notice Lets the owner transfer the wallet ownership. This is executed immediately.
     * @param _wallet The target wallet.
     * @param _newOwner The address to which ownership should be transferred.
     */
    function transferOwnership(address _wallet, address _newOwner) external onlySelf() onlyWhenUnlocked(_wallet) {
        validateNewOwner(_wallet, _newOwner);
        IWallet(_wallet).setOwner(_newOwner);

        emit OwnershipTransfered(_wallet, _newOwner);
    }

    /**
    * @notice Gets the details of the ongoing recovery procedure if any.
    * @param _wallet The target wallet.
    */
    function getRecovery(address _wallet) external view returns(address _address, uint64 _executeAfter, uint32 _guardianCount) {
        RecoveryConfig storage config = recoveryConfigs[_wallet];
        return (config.recovery, config.executeAfter, config.guardianCount);
    }

    // *************** Lock functions ************************ //

    /**
     * @notice Lets a guardian lock a wallet.
     * @param _wallet The target wallet.
     */
    function lock(address _wallet) external onlyGuardianOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        _setLock(_wallet, block.timestamp + lockPeriod, SecurityManager.lock.selector);
        emit Locked(_wallet, uint64(block.timestamp + lockPeriod));
    }

    /**
     * @notice Lets a guardian unlock a locked wallet.
     * @param _wallet The target wallet.
     */
    function unlock(address _wallet) external onlyGuardianOrSelf(_wallet) onlyWhenLocked(_wallet) {
        require(locks[_wallet].locker == SecurityManager.lock.selector, "SM: cannot unlock");
        _setLock(_wallet, 0, bytes4(0));
        emit Unlocked(_wallet);
    }

    /**
     * @notice Returns the release time of a wallet lock or 0 if the wallet is unlocked.
     * @param _wallet The target wallet.
     * @return _releaseAfter The epoch time at which the lock will release (in seconds).
     */
    function getLock(address _wallet) external view returns(uint64 _releaseAfter) {
        return _isLocked(_wallet) ? locks[_wallet].release : 0;
    }

    /**
     * @notice Checks if a wallet is locked.
     * @param _wallet The target wallet.
     * @return _isLocked `true` if the wallet is locked otherwise `false`.
     */
    function isLocked(address _wallet) external view returns (bool) {
        return _isLocked(_wallet);
    }

    // *************** Guardian functions ************************ //

    /**
     * @notice Lets the owner add a guardian to its wallet.
     * The first guardian is added immediately. All following additions must be confirmed
     * by calling the confirmGuardianAddition() method.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to add.
     */
    function addGuardian(address _wallet, address _guardian) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        require(!_isOwner(_wallet, _guardian), "SM: guardian cannot be owner");
        require(!isGuardian(_wallet, _guardian), "SM: duplicate guardian");
        // Guardians must either be an EOA or a contract with an owner()
        // method that returns an address with a 25000 gas stipend.
        // Note that this test is not meant to be strict and can be bypassed by custom malicious contracts.
        (bool success,) = _guardian.call{gas: 25000}(abi.encodeWithSignature("owner()"));
        require(success, "SM: must be EOA/Argent wallet");

        bytes32 id = keccak256(abi.encodePacked(_wallet, _guardian, "addition"));
        GuardianManagerConfig storage config = guardianConfigs[_wallet];
        require(
            config.pending[id] == 0 || block.timestamp > config.pending[id] + securityWindow,
            "SM: duplicate pending addition");
        config.pending[id] = block.timestamp + securityPeriod;
        emit GuardianAdditionRequested(_wallet, _guardian, block.timestamp + securityPeriod);
    }

    /**
     * @notice Confirms the pending addition of a guardian to a wallet.
     * The method must be called during the confirmation window and can be called by anyone to enable orchestration.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function confirmGuardianAddition(address _wallet, address _guardian) external onlyWhenUnlocked(_wallet) {
        bytes32 id = keccak256(abi.encodePacked(_wallet, _guardian, "addition"));
        GuardianManagerConfig storage config = guardianConfigs[_wallet];
        require(config.pending[id] > 0, "SM: unknown pending addition");
        require(config.pending[id] < block.timestamp, "SM: pending addition not over");
        require(block.timestamp < config.pending[id] + securityWindow, "SM: pending addition expired");
        guardianStorage.addGuardian(_wallet, _guardian);
        emit GuardianAdded(_wallet, _guardian);
        delete config.pending[id];
    }

    /**
     * @notice Lets the owner cancel a pending guardian addition.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function cancelGuardianAddition(address _wallet, address _guardian) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        bytes32 id = keccak256(abi.encodePacked(_wallet, _guardian, "addition"));
        GuardianManagerConfig storage config = guardianConfigs[_wallet];
        require(config.pending[id] > 0, "SM: unknown pending addition");
        delete config.pending[id];
        emit GuardianAdditionCancelled(_wallet, _guardian);
    }

    /**
     * @notice Lets the owner revoke a guardian from its wallet.
     * @dev Revokation must be confirmed by calling the confirmGuardianRevokation() method.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to revoke.
     */
    function revokeGuardian(address _wallet, address _guardian) external onlyWalletOwnerOrSelf(_wallet) {
        require(isGuardian(_wallet, _guardian), "SM: must be existing guardian");
        bytes32 id = keccak256(abi.encodePacked(_wallet, _guardian, "revokation"));
        GuardianManagerConfig storage config = guardianConfigs[_wallet];
        require(
            config.pending[id] == 0 || block.timestamp > config.pending[id] + securityWindow,
            "SM: duplicate pending revoke"); // TODO need to allow if confirmation window passed
        config.pending[id] = block.timestamp + securityPeriod;
        emit GuardianRevokationRequested(_wallet, _guardian, block.timestamp + securityPeriod);
    }

    /**
     * @notice Confirms the pending revokation of a guardian to a wallet.
     * The method must be called during the confirmation window and can be called by anyone to enable orchestration.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function confirmGuardianRevokation(address _wallet, address _guardian) external {
        bytes32 id = keccak256(abi.encodePacked(_wallet, _guardian, "revokation"));
        GuardianManagerConfig storage config = guardianConfigs[_wallet];
        require(config.pending[id] > 0, "SM: unknown pending revoke");
        require(config.pending[id] < block.timestamp, "SM: pending revoke not over");
        require(block.timestamp < config.pending[id] + securityWindow, "SM: pending revoke expired");
        guardianStorage.revokeGuardian(_wallet, _guardian);
        emit GuardianRevoked(_wallet, _guardian);
        delete config.pending[id];
    }

    /**
     * @notice Lets the owner cancel a pending guardian revokation.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function cancelGuardianRevokation(address _wallet, address _guardian) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        bytes32 id = keccak256(abi.encodePacked(_wallet, _guardian, "revokation"));
        GuardianManagerConfig storage config = guardianConfigs[_wallet];
        require(config.pending[id] > 0, "SM: unknown pending revoke");
        delete config.pending[id];
        emit GuardianRevokationCancelled(_wallet, _guardian);
    }

    /**
     * @notice Checks if an address is a guardian for a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The address to check.
     * @return _isGuardian `true` if the address is a guardian for the wallet otherwise `false`.
     */
    function isGuardian(address _wallet, address _guardian) public view returns (bool _isGuardian) {
        return guardianStorage.isGuardian(_wallet, _guardian);
    }

    /**
    * @notice Checks if an address is a guardian or an account authorised to sign on behalf of a smart-contract guardian.
    * @param _wallet The target wallet.
    * @param _guardian the address to test
    * @return _isGuardian `true` if the address is a guardian for the wallet otherwise `false`.
    */
    function isGuardianOrGuardianSigner(address _wallet, address _guardian) external view returns (bool _isGuardian) {
        (_isGuardian, ) = Utils.isGuardianOrGuardianSigner(guardianStorage.getGuardians(_wallet), _guardian);
    }

    /**
     * @notice Counts the number of active guardians for a wallet.
     * @param _wallet The target wallet.
     * @return _count The number of active guardians for a wallet.
     */
    function guardianCount(address _wallet) external view returns (uint256 _count) {
        return guardianStorage.guardianCount(_wallet);
    }

    /**
     * @notice Get the active guardians for a wallet.
     * @param _wallet The target wallet.
     * @return _guardians the active guardians for a wallet.
     */
    function getGuardians(address _wallet) external view returns (address[] memory _guardians) {
        return guardianStorage.getGuardians(_wallet);
    }

    // *************** Internal Functions ********************* //

    function validateNewOwner(address _wallet, address _newOwner) internal view {
        require(_newOwner != address(0), "SM: new owner cannot be null");
        require(!isGuardian(_wallet, _newOwner), "SM: new owner cannot be guardian");
    }

    function _setLock(address _wallet, uint256 _releaseAfter, bytes4 _locker) internal {
        locks[_wallet] = Lock(SafeCast.toUint64(_releaseAfter), _locker);
    }
}