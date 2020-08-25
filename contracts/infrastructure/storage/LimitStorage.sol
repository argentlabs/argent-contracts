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
pragma experimental ABIEncoderV2;

import "./ILimitStorage.sol";
import "./Storage.sol";

/**
 * @title LimitStorage
 * @notice Contract storing the state of wallets related daily limits.
 * The contract only defines basic setters and getters with no logic.
 * Only the modules of a wallet can modify its state.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract LimitStorage is ILimitStorage, Storage {

    struct LimitManagerConfig {
        // The daily limit
        ILimitStorage.Limit limit;
        // The current usage
        ILimitStorage.DailySpent dailySpent;
    }

    // wallet specific storage
    mapping (address => LimitManagerConfig) internal limits;

    function setLimit(address _wallet, ILimitStorage.Limit memory _limit) external override onlyFeature(_wallet) {
        limits[_wallet].limit = _limit;
    }

    function getLimit(address _wallet) external override view returns (ILimitStorage.Limit memory _limit) {
        return limits[_wallet].limit;
    }

    function setDailySpent(address _wallet, ILimitStorage.DailySpent memory _dailySpent) external override onlyFeature(_wallet) {
        limits[_wallet].dailySpent = _dailySpent;
    }

    function getDailySpent(address _wallet) external override view returns (ILimitStorage.DailySpent memory _dailySpent) {
        return limits[_wallet].dailySpent;
    }

    function setLimitAndDailySpent(
        address _wallet,
        ILimitStorage.Limit memory _limit,
        ILimitStorage.DailySpent memory _dailySpent
    )
        external
        override
        onlyFeature(_wallet)
    {
        limits[_wallet].limit = _limit;
        limits[_wallet].dailySpent = _dailySpent;
    }

    function getLimitAndDailySpent(
        address _wallet
    )
        external
        override
        view
        returns (ILimitStorage.Limit memory _limit, ILimitStorage.DailySpent memory _dailySpent)
    {
        return (limits[_wallet].limit, limits[_wallet].dailySpent);
    }
}