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

/**
 * @title ILimitStorage
 * @dev LimitStorage interface
 */
interface ILimitStorage {

    function setLimit(address _wallet, uint256 _current, uint256 _pending, uint256 _changeAfter) external;

    function getLimit(address _wallet) external view returns (uint256, uint256, uint256);

    function setDailySpent(address _wallet, uint256 _alreadySpent, uint256 _periodEnd) external;

    function getDailySpent(address _wallet) external view returns (uint256, uint256);

    function setLimitAndDailySpent(
        address _wallet,
        uint256 _current,
        uint256 _pending,
        uint256 _changeAfter,
        uint256 _alreadySpent,
        uint256 _periodEnd
    )
        external;

    function getLimitAndDailySpent(address _wallet) external view returns (uint256, uint256, uint256, uint256, uint256);
}