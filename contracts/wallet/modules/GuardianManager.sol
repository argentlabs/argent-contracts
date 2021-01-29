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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

import "../base/Utils.sol";
import "../base/BaseModule.sol";
import "./IGuardianManager.sol";

/**
 * @title GuardianManager
 * @notice Module to manage the guardians of wallets.
 * Guardians are accounts (EOA or contracts) that are authorized to perform specific security operations on wallet
 * such as toggle a safety lock, start a recovery procedure, or confirm transactions.
 * Addition or revokation of guardians is initiated by the owner of a wallet and must be confirmed after a security period (e.g. 24 hours).
 * The list of guardians for a wallet is stored on a separate contract to facilitate its use by other modules.
 * @author Julien Niset - <julien@argent.xyz>
 * @author Olivier Van Den Biggelaar - <olivier@argent.xyz>
 */
contract GuardianManager is IGuardianManager, BaseModule {
    /**
    * @inheritdoc IGuardianManager
    */
    function addGuardian(address _guardian) external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        require(owner != _guardian, "GM: target guardian cannot be owner");
        require(!isGuardian(_guardian), "GM: target is already a guardian");
        // Guardians must either be an EOA or a contract with an owner()
        // method that returns an address with a 5000 gas stipend.
        // Note that this test is not meant to be strict and can be bypassed by custom malicious contracts.
        (bool success,) = _guardian.call{gas: 5000}(abi.encodeWithSignature("owner()"));
        require(success, "GM: guardian must be EOA or implement owner()");
        uint256 _securityPeriod = Configuration(registry).securityPeriod();

        if (guardiansCount == 0) {
            _addGuardian(_guardian);
        } else {
            bytes32 id = keccak256(abi.encodePacked(_guardian, "addition"));
            require(
                pending[id] == 0 || block.timestamp > pending[id] + Configuration(registry).securityWindow(),
                "GM: addition of target as guardian is already pending");
            pending[id] = block.timestamp + _securityPeriod;
            emit GuardianAdditionRequested(address(this), _guardian, block.timestamp + _securityPeriod);
        }
    }

    /**
    * @inheritdoc IGuardianManager
    */
    function confirmGuardianAddition(address _guardian) external override onlyWhenUnlocked() {
        bytes32 id = keccak256(abi.encodePacked(_guardian, "addition"));

        require(pending[id] > 0, "GM: no pending addition as guardian for target");
        require(pending[id] < block.timestamp, "GM: Too early to confirm guardian addition");
        require(block.timestamp < pending[id] + Configuration(registry).securityWindow(), "GM: Too late to confirm guardian addition");
        
        _addGuardian(_guardian);
        delete pending[id];
    }

    /**
    * @inheritdoc IGuardianManager
    */
    function cancelGuardianAddition(address _guardian) external override onlyWalletOwner() onlyWhenUnlocked() {
        bytes32 id = keccak256(abi.encodePacked(_guardian, "addition"));

        require(pending[id] > 0, "GM: no pending addition as guardian for target");
        delete pending[id];
        emit GuardianAdditionCancelled(address(this), _guardian);
    }

    /**
    * @inheritdoc IGuardianManager
    */
    function revokeGuardian(address _guardian) external override onlyWalletOwner() {
        require(isGuardian(_guardian), "GM: must be an existing guardian");
        bytes32 id = keccak256(abi.encodePacked(_guardian, "revokation"));

        uint256 _securityPeriod = Configuration(registry).securityPeriod();
        require(
            pending[id] == 0 || block.timestamp > (pending[id] + Configuration(registry).securityWindow()),
            "GM: revokation of target as guardian is already pending"); // TODO need to allow if confirmation window passed
        pending[id] = block.timestamp + _securityPeriod;
        emit GuardianRevokationRequested(address(this), _guardian, block.timestamp + _securityPeriod);
    }

    /**
    * @inheritdoc IGuardianManager
    */
    function confirmGuardianRevokation(address _guardian) external override {
        bytes32 id = keccak256(abi.encodePacked(_guardian, "revokation"));

        require(pending[id] > 0, "GM: no pending guardian revokation for target");
        require(pending[id] < block.timestamp, "GM: Too early to confirm guardian revokation");
        require(block.timestamp < (pending[id] + Configuration(registry).securityWindow()), "GM: Too late to confirm guardian revokation");

        guardians[_guardian] = false;

        emit GuardianRevoked(address(this), _guardian);
        delete pending[id];
    }

    /**
    * @inheritdoc IGuardianManager
    */
    function cancelGuardianRevokation(address _guardian) external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        bytes32 id = keccak256(abi.encodePacked(_guardian, "revokation"));

        require(pending[id] > 0, "GM: no pending guardian revokation for target");
        delete pending[id];
        emit GuardianRevokationCancelled(address(this), _guardian);
    }

    function _addGuardian(address _guardian) private {
        guardians[_guardian] = true;
        guardiansCount += 1;
    
        emit GuardianAdded(address(this), _guardian);
    }
}