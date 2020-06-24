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
pragma solidity ^0.6.10;

/**
 * @title ILimitStorage
 * @dev LimitStorage interface
 */
interface ILimitStorage {

    function setLimit(address _wallet, uint128 _current, uint128 _pending, uint64 _changeAfter) external;

    function getLimit(address _wallet) external view returns (uint128, uint128, uint64);

    function setDailySpent(address _wallet, uint128 _alreadySpent, uint64 _periodEnd) external;

    function getDailySpent(address _wallet) external view returns (uint128, uint64);

    function setLimitAndDailySpent(
        address _wallet,
        uint128 _current,
        uint128 _pending,
        uint64 _changeAfter,
        uint128 _alreadySpent,
        uint64 _periodEnd
    )
        external;

    function getLimitAndDailySpent(address _wallet) external view returns (uint128, uint128, uint64, uint128, uint64);
}