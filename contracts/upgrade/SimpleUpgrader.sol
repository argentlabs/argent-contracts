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

import "../modules/common/BaseModule.sol";

/**
 * @title SimpleUpgrader
 * @dev Temporary module used to add/remove other modules.
 * @author Olivier VDB - <olivier@argent.xyz>, Julien Niset - <julien@argent.im>
 */
contract SimpleUpgrader is BaseModule {

    bytes32 constant NAME = "SimpleUpgrader";
    address[] public toDisable;
    address[] public toEnable;

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        address[] memory _toDisable,
        address[] memory _toEnable
    )
        BaseModule(_registry, GuardianStorage(0), NAME)
        public
    {
        toDisable = _toDisable;
        toEnable = _toEnable;
    }

    // *************** External/Public Functions ********************* //

    /**
     * @dev Perform the upgrade for a wallet. This method gets called
     * when SimpleUpgrader is temporarily added as a module.
     * @param _wallet The target wallet.
     */
    function init(BaseWallet _wallet) public onlyWallet(_wallet) {
        uint256 i = 0;
        //add new modules
        for (; i < toEnable.length; i++) {
            BaseWallet(_wallet).authoriseModule(toEnable[i], true);
        }
        //remove old modules
        for (i = 0; i < toDisable.length; i++) {
            BaseWallet(_wallet).authoriseModule(toDisable[i], false);
        }
        // SimpleUpgrader did its job, we no longer need it as a module
        BaseWallet(_wallet).authoriseModule(address(this), false);
    }
}