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
pragma solidity ^0.6.9;

import "./BaseModule.sol";
import "./RelayerModule.sol";

/**
 * @title OnlyOwnerModule
 * @dev Module that extends BaseModule and RelayerModule for modules where the execute() method
 * must be called with one signature frm the owner.
 * @author Julien Niset - <julien@argent.im>
 */
abstract contract OnlyOwnerModule is BaseModule, RelayerModule {

    // bytes4 private constant IS_ONLY_OWNER_MODULE = bytes4(keccak256("isOnlyOwnerModule()"));

   /**
    * @dev Returns a constant that indicates that the module is an OnlyOwnerModule.
    * @return The constant bytes4(keccak256("isOnlyOwnerModule()"))
    */
    function isOnlyOwnerModule() external pure returns (bytes4) {
        // return IS_ONLY_OWNER_MODULE;
        return this.isOnlyOwnerModule.selector;
    }

    /**
     * @dev Adds a module to a wallet. First checks that the module is registered.
     * Unlike its overrided parent, this method can be called via the RelayerModule's execute()
     * @param _wallet The target wallet.
     * @param _module The modules to authorise.
     */
    function addModule(address _wallet, address _module) external override virtual onlyWalletOwner(_wallet) {
        require(registry.isRegisteredModule(_module), "BM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true);
    }

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(address _wallet, uint256 _nonce, bytes32 /* _signHash */) internal override returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function getRequiredSignatures(address /* _wallet */, bytes memory /* _data */) public view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}