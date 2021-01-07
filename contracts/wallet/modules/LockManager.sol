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
pragma solidity ^0.7.6;

import "../base/BaseModule.sol";
import "./ILockManager.sol";

/**
 * @title LockManager
 * @notice Feature to manage the state of a wallet's lock.
 * Other features can use the state of the lock to determine if their operations
 * should be authorised or blocked. Only the guardians of a wallet can lock and unlock it.
 * The lock automatically unlocks after a given period. The lock state is stored on a separate
 * contract to facilitate its use by other features.
 * @author Julien Niset - <julien@argent.xyz>
 * @author Olivier Van Den Biggelaar - <olivier@argent.xyz>
 */
contract LockManager is ILockManager, BaseModule {
    /**
     * @notice Lets a guardian lock a wallet.
     */
    function lock() internal
    onlyGuardian()
    onlyWhenUnlocked()
    {
        setLock(block.timestamp + lockPeriod);
        emit Locked(_wallet, uint64(block.timestamp + lockPeriod));
    }

    /**
     * @notice Lets a guardian unlock a locked wallet.
     */
    function unlock() internal
    onlyGuardian()
    onlyWhenLocked()
    {
        require(locker == address(this), "LM: cannot unlock a wallet that was locked by another feature");
        setLock(_wallet, 0);
        emit Unlocked(_wallet);
    }

    /**
     * @notice Returns the release time of a wallet lock or 0 if the wallet is unlocked.
     * @return _releaseAfter The epoch time at which the lock will release (in seconds).
     */
    function getLock() public override view returns(uint64 _releaseAfter) {
        if (lockRelease > block.timestamp) {
            _releaseAfter = uint64(lockRelease);
        }
    }

    /**
     * @notice Checks if a wallet is locked.
     * @param _wallet The target wallet.
     * @return _isLocked `true` if the wallet is locked otherwise `false`.
     */
    function isLocked(address _wallet) external view returns (bool _isLocked) {
        return isLocked(_wallet);
    }

    /**
     * @dev Lets an authorised module set the lock for a wallet.
     * @param _wallet The target wallet.
     * @param _locker The feature doing the lock.
     * @param _releaseAfter The epoch time at which the lock should automatically release.
     */
    function setLock(address _locker, uint256 _releaseAfter) private {
        lock = _releaseAfter;
        if (_releaseAfter != 0 && _locker != locker) {
            locker = _locker;
        }
    }
}