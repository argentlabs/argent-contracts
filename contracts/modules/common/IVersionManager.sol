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
pragma solidity >=0.5.4 <0.7.0;
pragma experimental ABIEncoderV2;

import "../../infrastructure/storage/ILimitStorage.sol";

/**
 * @title IVersionManager
 * @notice Interface for the VersionManager module.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
interface IVersionManager {
    /**
     * @notice Returns true if the feature is authorised for the wallet
     * @param _wallet The target wallet.
     * @param _feature The feature.
     */
    function isFeatureAuthorised(address _wallet, address _feature) external view returns (bool);

    /**
     * @notice Lets a feature (caller) invoke a wallet.
     * @param _wallet The target wallet.
     * @param _to The target address for the transaction.
     * @param _value The value of the transaction.
     * @param _data The data of the transaction.
     */
    function invokeWallet(address _wallet, address _to, uint256 _value, bytes calldata _data) external returns (bytes memory _res);

    /* ******* Backward Compatibility with old Storages and BaseWallet *************** */

    /**
     * @notice Sets a new owner for the wallet.
     * @param _newOwner The new owner.
     */
    function setOwner(address _wallet, address _newOwner) external;

    /**
     * @notice Lets a feature add or remove an account from the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The account to add/remove.
     * @param _whitelistAfter The epoch time at which an account starts to be whitelisted, or zero if the account is not whitelisted
     */
    function setWhitelist(address _wallet, address _target, uint256 _whitelistAfter) external;

    /**
     * @notice Lets a feature add a guardian to a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to add.
     */
    function addGuardian(address _wallet, address _guardian) external;

    /**
     * @notice Lets a feature revoke a guardian from a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to revoke.
     */
    function revokeGuardian(address _wallet, address _guardian) external;

    /**
     * @notice Lets a feature set the lock for a wallet.
     * @param _wallet The target wallet.
     * @param _releaseAfter The epoch time at which the lock should automatically release.
     */
    function setLock(address _wallet, uint256 _releaseAfter) external;

    /**
     * @notice Lets a feature set the daily limit for a wallet.
     * @param _wallet The target wallet.
     * @param _limit The new limit
     */
    function setLimit(address _wallet, ILimitStorage.Limit memory _limit) external;

    /**
     * @notice Lets a feature set the daily spent for a wallet.
     * @param _wallet The target wallet.
     * @param _dailySpent The new daily spent
     */
    function setDailySpent(address _wallet, ILimitStorage.DailySpent memory _dailySpent) external;

    /**
     * @notice Lets a feature set the daily spent for a wallet.
     * @param _wallet The target wallet.
     * @param _limit The new limit
     * @param _dailySpent The new daily spent
     */
    function setLimitAndDailySpent(address _wallet, ILimitStorage.Limit memory _limit, ILimitStorage.DailySpent memory _dailySpent) external;

}