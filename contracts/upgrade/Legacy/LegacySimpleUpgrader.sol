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

import "./LegacyUpgrader.sol";
import "../../wallet/BaseWallet.sol";

/**
 * @title LegacySimpleUpgrader
 * @dev Old implementation for the Upgrader interface that added/removed modules.
 * @author Julien Niset - <julien@argent.im>
 */
contract LegacySimpleUpgrader is LegacyUpgrader {

    address[] private disable;
    address[] private enable;

    constructor(address[] memory _disable, address[] memory _enable) public {
        disable = _disable;
        enable = _enable;
    }

    function upgrade(address payable _wallet, address[] calldata _toDisable, address[] calldata _toEnable) external {
        uint256 i = 0;
        //add new modules
        for (i = 0; i < _toEnable.length; i++) {
            BaseWallet(_wallet).authoriseModule(_toEnable[i], true);
        }
        //remove old modules
        for (i = 0; i < _toDisable.length; i++) {
            BaseWallet(_wallet).authoriseModule(_toDisable[i], false);
        }
    }

    function toDisable() external view returns (address[] memory) {
        return disable;
    }

    function toEnable() external view returns (address[] memory) {
        return enable;
    }
}