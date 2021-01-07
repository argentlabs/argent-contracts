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
pragma solidity ^0.7.6;

import "./DelegateProxy.sol";
import "./IWallet.sol";
import "../infrastructure/base/Managed.sol";

/**
 * @title WalletFactory
 * @notice The WalletFactory contract creates and assigns wallets to accounts.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract WalletFactory is Managed {

    // The latest available version of the wallet
    uint256 public latestVersion;
    // Registry mapping per wallet version. Versioning is incremental starting from 1. 
    mapping (uint256 => address) public registries;

    event WalletVersionAdded(uint indexed version, address indexed registry);
    event WalletCreated(address indexed wallet, address indexed owner, address indexed guardian, uint indexed version);

    /**
     * @notice Lets the owner add a new wallet version, i.e. a new registry of functions in modules.
     * @param _registry address of the matching registry
     */
    function addVersion(address _registry) external onlyOwner {
        uint256 newVersion = ++latestVersion;
        registries[newVersion] = _registry;
        
        emit WalletVersionAdded(newVersion, _registry);
    }

    /**
     * @notice Lets the manager create a wallet for an owner account.
     * The wallet is initialised with the latest version and modules and a first guardian.
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _guardian The guardian address.
     */
    function createWallet(
        address _owner,
        address _guardian
    )
        external
        onlyManager
    {
        validateInputs(_owner, _guardian, latestVersion);
        DelegateProxy proxy = new DelegateProxy();
        configureWallet(proxy, _owner, _guardian, latestVersion);
    }
     
    /**
     * @notice Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with the version manager module, the version number and a first guardian.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @param _version The version of the feature bundle.
     */
    function createCounterfactualWallet(
        address _owner,
        address _guardian,
        bytes32 _salt,
        uint256 _version
    )
        external
        onlyManager
        returns (address _wallet)
    {
        validateInputs(_owner, _guardian, _version);
        bytes32 newsalt = newSalt(_salt, _owner, _guardian, _version);
        DelegateProxy proxy = new DelegateProxy{salt: newsalt}();
        configureWallet(proxy, _owner, _guardian, _version);
        return wallet;
    }

    /**
     * @notice Gets the address of a counterfactual wallet with a first default guardian.
     * @param _owner The account address.
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @param _version The version of feature bundle.
     * @return _wallet The address that the wallet will have when created using CREATE2 and the same input parameters.
     */
    function getAddressForCounterfactualWallet(
        address _owner,
        address _guardian,
        bytes32 _salt,
        uint256 _version
    )
        external
        view
        returns (address _wallet)
    {
        validateInputs(_owner, _guardian, _version);
        bytes32 newsalt = newSalt(_salt, _owner, _guardian, _version);
        bytes memory code = abi.encodePacked(type(DelegateProxy).creationCode);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
    }


    // *************** Internal Functions ********************* //

    /**
     * @notice Helper method to configure a wallet for a set of input parameters.
     * @param _wallet The target wallet
     * @param _owner The account address.
     * @param _guardian The guardian address.
     * @param _version The version of the feature bundle.
     */
    function configureWallet(
        DelegateProxy _wallet,
        address _owner,
        address _guardian,
        uint256 _version
    )
        internal
    {
        _wallet.setRegistry(registries[_version]);
        _wallet.addGuardian(_guardian);
        _wallet.setOwner(_owner);
 
        emit WalletCreated(address(_wallet), _owner, _guardian, _version);
    }

    /**
     * @notice Generates a new salt based on a provided salt, an owner, a list of modules and an optional guardian.
     * @param _salt The slat provided.
     * @param _owner The owner address.
     * @param _guardian The guardian address.
     * @param _version The version of feature bundle
     */
    function newSalt(bytes32 _salt, address _owner, address _guardian, uint256 _version) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_salt, _owner, _guardian, _version));
    }

    /**
     * @notice Throws if the owner, guardian, version or version manager is invalid.
     * @param _owner The owner address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address
     * @param _version The version of feature bundle
     */
    function validateInputs(address _owner, address _guardian, uint256 _version) internal view {
        require(_owner != address(0), "WF: owner cannot be null");
        require(_guardian != (address(0)), "WF: guardian cannot be null");
        require(_version > 0, "WF: invalid _version");
    }
}
