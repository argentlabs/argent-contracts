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

import "./common/IModule.sol";
import "../infrastructure/IModuleRegistry.sol";
import "../wallet/IWallet.sol";

/**
 * @title SimpleUpgrader
 * @notice Temporary module used to add/remove other modules.
 * @author Olivier VDB - <olivier@argent.xyz>, Julien Niset - <julien@argent.xyz>
 */
contract SimpleUpgrader is IModule {

    IModuleRegistry private registry;
    address[] public toDisable;
    address[] public toEnable;

    // *************** Constructor ********************** //

    constructor(
        IModuleRegistry _registry,
        address[] memory _toDisable,
        address[] memory _toEnable
    )
        public
    {
        registry = _registry;
        toDisable = _toDisable;
        toEnable = _toEnable;
    }

    // *************** External/Public Functions ********************* //

    /**
     * @notice Perform the upgrade for a wallet. This method gets called when SimpleUpgrader is temporarily added as a module.
     * @param _wallet The target wallet.
     */
    function init(address _wallet) public override {
        require(msg.sender == _wallet, "SU: only wallet can call init");
        require(registry.isRegisteredModule(toEnable), "SU: Not all modules are registered");

        uint256 i = 0;
        //add new modules
        for (; i < toEnable.length; i++) {
            IWallet(_wallet).authoriseModule(toEnable[i], true);
        }
        //remove old modules
        for (i = 0; i < toDisable.length; i++) {
            IWallet(_wallet).authoriseModule(toDisable[i], false);
        }
        // SimpleUpgrader did its job, we no longer need it as a module
        IWallet(_wallet).authoriseModule(address(this), false);
    }
}