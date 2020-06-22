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

import "./Storage.sol";
import "./ILimitStorage.sol";

/**
 * @title LimitStorage
 * @dev Contract storing the state of wallets related daily limits.
 * The contract only defines basic setters and getters with no logic.
 * Only the modules of a wallet can modify its state.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract LimitStorage is ILimitStorage, Storage {

    struct LimitManagerConfig {
        // The daily limit
        Limit limit;
        // The current usage
        DailySpent dailySpent;
    }

    struct Limit {
        // the current limit
        uint128 current;
        // the pending limit if any
        uint128 pending;
        // when the pending limit becomes the current limit
        uint64 changeAfter;
    }

    struct DailySpent {
        // The amount already spent during the current period
        uint128 alreadySpent;
        // The end of the current period
        uint64 periodEnd;
    }

    // wallet specific storage
    mapping (address => LimitManagerConfig) internal limits;

    function setLimit(address _wallet, uint128 _current, uint128 _pending, uint64 _changeAfter) external onlyModule(_wallet) {
        Limit storage limit = limits[_wallet].limit;
        limit.current = _current;
        limit.pending = _pending;
        limit.changeAfter = _changeAfter;
    }

    function getLimit(address _wallet) external view returns (uint128, uint128, uint64) {
        Limit storage limit = limits[_wallet].limit;
        return (limit.current, limit.pending, limit.changeAfter);
    }

    function setDailySpent(address _wallet, uint128 _alreadySpent, uint64 _periodEnd) external onlyModule(_wallet) {
        DailySpent storage expense = limits[_wallet].dailySpent;
        expense.alreadySpent = _alreadySpent;
        expense.periodEnd = _periodEnd;
    }

    function getDailySpent(address _wallet) external view returns (uint128, uint64) {
        DailySpent storage expense = limits[_wallet].dailySpent;
        return (expense.alreadySpent, expense.periodEnd);
    }

    function setLimitAndDailySpent(
        address _wallet,
        uint128 _current,
        uint128 _pending,
        uint64 _changeAfter,
        uint128 _alreadySpent,
        uint64 _periodEnd
    )
        external
        onlyModule(_wallet)
    {
        LimitManagerConfig storage config = limits[_wallet];
        config.limit.current = _current;
        config.limit.pending = _pending;
        config.limit.changeAfter = _changeAfter;
        config.dailySpent.alreadySpent = _alreadySpent;
        config.dailySpent.periodEnd = _periodEnd;
    }

    function getLimitAndDailySpent(address _wallet) external view returns (uint128, uint128, uint64, uint128, uint64) {
        Limit storage limit = limits[_wallet].limit;
        DailySpent storage expense = limits[_wallet].dailySpent;
        return (limit.current, limit.pending, limit.changeAfter, expense.alreadySpent, expense.periodEnd);
    }

}