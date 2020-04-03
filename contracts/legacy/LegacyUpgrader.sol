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

/**
 * @title Legacy Upgrader
 * @dev Old Interface for a contract that could upgrade wallets by enabling/disabling modules.
 * @author Julien Niset - <julien@argent.im>
 */
interface LegacyUpgrader {

    /**
     * @dev Upgrades a wallet by enabling/disabling modules.
     * @param _wallet The owner.
     */
    function upgrade(address payable _wallet, address[] calldata _toDisable, address[] calldata _toEnable) external;

    function toDisable() external view returns (address[] memory);
    function toEnable() external view returns (address[] memory);
}