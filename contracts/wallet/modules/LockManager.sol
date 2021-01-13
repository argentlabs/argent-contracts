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

import "../base/BaseModule.sol";
import "../base/Configuration.sol";
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
     * @inheritdoc ILockManager
     */
    function lock() external override
    onlyGuardian()
    onlyWhenUnlocked()
    {
        uint256 _lockPeriod = Configuration(registry).lockPeriod();
        setLock(block.timestamp + _lockPeriod);
        emit Locked(address(this), uint64(block.timestamp + _lockPeriod));
    }

    /**
     * @inheritdoc ILockManager
     */
    function unlock() external override
    onlyGuardian()
    onlyWhenLocked()
    {
        require(walletLock.module == LockModule.LockManager, "LM: cannot unlock a wallet that was locked by another feature");
        setLock(0);
        emit Unlocked(address(this));
    }

    /**
     * @inheritdoc ILockManager
     */
    function getLock() public override view returns(uint256 _releaseAfter) {
        if (walletLock.releaseAfter > block.timestamp) {
            return walletLock.releaseAfter;
        }
    }

    /**
     * @dev Set the lock for a wallet.
     * @param _releaseAfter The epoch time at which the lock should automatically release.
     */
    function setLock(uint256 _releaseAfter) private {
        walletLock.releaseAfter = _releaseAfter;
        if (_releaseAfter != 0 && walletLock.module != LockModule.LockManager) {
            walletLock.module = LockModule.LockManager;
        }
    }
}