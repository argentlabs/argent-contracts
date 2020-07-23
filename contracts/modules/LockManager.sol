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
pragma solidity ^0.6.12;

import "./common/BaseModule.sol";
import "./common/GuardianUtils.sol";

/**
 * @title LockManager
 * @dev Module to manage the state of a wallet's lock.
 * Other modules can use the state of the lock to determine if their operations
 * should be authorised or blocked. Only the guardians of a wallet can lock and unlock it.
 * The lock automatically unlocks after a given period. The lock state is stored on a saparate
 * contract to facilitate its use by other modules.
 * @author Julien Niset - <julien@argent.im>
 * @author Olivier Van Den Biggelaar - <olivier@argent.im>
 */
contract LockManager is BaseModule {

    bytes32 constant NAME = "LockManager";

    // The lock period
    uint256 public lockPeriod;

    // *************** Events *************************** //

    event Locked(address indexed wallet, uint64 releaseAfter);
    event Unlocked(address indexed wallet);

    // *************** Modifiers ************************ //

    /**
     * @dev Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked(address _wallet) {
        require(guardianStorage.isLocked(_wallet), "LM: wallet must be locked");
        _;
    }

    /**
     * @dev Throws if the caller is not a guardian for the wallet.
     */
    modifier onlyGuardianOrModule(address _wallet) {
        (bool isGuardian, ) = GuardianUtils.isGuardian(guardianStorage.getGuardians(_wallet), msg.sender);
        require(isAuthorisedModule(_wallet, msg.sender) || isGuardian, "LM: must be guardian or module");
        _;
    }

    // *************** Constructor ************************ //

    constructor(
        IModuleRegistry _registry,
        IGuardianStorage _guardianStorage,
        uint256 _lockPeriod
    )
        BaseModule(_registry, _guardianStorage, NAME) public {
        lockPeriod = _lockPeriod;
    }

    // *************** External functions ************************ //

    /**
     * @dev Lets a guardian lock a wallet.
     * @param _wallet The target wallet.
     */
    function lock(address _wallet) external onlyGuardianOrModule(_wallet) onlyWhenUnlocked(_wallet) {
        guardianStorage.setLock(_wallet, now + lockPeriod);
        emit Locked(_wallet, uint64(now + lockPeriod));
    }

    /**
     * @dev Lets a guardian unlock a locked wallet.
     * @param _wallet The target wallet.
     */
    function unlock(address _wallet) external onlyGuardianOrModule(_wallet) onlyWhenLocked(_wallet) {
        address locker = guardianStorage.getLocker(_wallet);
        require(locker == address(this), "LM: cannot unlock a wallet that was locked by another module");
        guardianStorage.setLock(_wallet, 0);
        emit Unlocked(_wallet);
    }

    /**
     * @dev Returns the release time of a wallet lock or 0 if the wallet is unlocked.
     * @param _wallet The target wallet.
     * @return _releaseAfter The epoch time at which the lock will release (in seconds).
     */
    function getLock(address _wallet) external view returns(uint64 _releaseAfter) {
        uint256 lockEnd = guardianStorage.getLock(_wallet);
        if (lockEnd > now) {
            _releaseAfter = uint64(lockEnd);
        }
    }

    /**
     * @dev Checks if a wallet is locked.
     * @param _wallet The target wallet.
     * @return _isLocked true if the wallet is locked.
     */
    function isLocked(address _wallet) external view returns (bool _isLocked) {
        return guardianStorage.isLocked(_wallet);
    }

    /**
    * @dev Implementation of the getRequiredSignatures from the IModule interface.
    * @param _wallet The target wallet.
    * @param _data The data of the relayed transaction.
    * @return The number of required signatures and the wallet owner signature requirement.
    */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Disallowed);
    }
}