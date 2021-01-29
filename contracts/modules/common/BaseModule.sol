// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.s

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../wallet/IWallet.sol";
import "../../infrastructure/IModuleRegistry.sol";
import "../../infrastructure/storage/ILockStorage.sol";
import "../../infrastructure/storage/IGuardianStorage.sol";
import "./IModule.sol";
import "../../../lib/other/ERC20.sol";

/**
 * @title BaseModule
 * @notice Base Module contract that contains methods common to all Modules.
 * @author Julien Niset - <julien@argent.xyz>, Olivier VDB - <olivier@argent.xyz>
 */
contract BaseModule is IModule {

    using SafeMath for uint256;

    // Empty calldata
    bytes constant internal EMPTY_BYTES = "";
    // Mock token address for ETH
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    bytes4 constant internal ADD_MODULE_PREFIX = bytes4(keccak256("addModule(address,address)"));


    // The Module Registry
    IModuleRegistry private registry;
    // The address of the Lock storage
    ILockStorage internal lockStorage;
    // The Guardian storage
    IGuardianStorage public guardianStorage;

    // The security period
    uint256 public securityPeriod;

    struct Session {
        address key;
        uint64 expires;
    }

    /**
     * @notice Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked(address _wallet) {
        require(_isLocked(_wallet), "LM: wallet must be locked");
        _;
    }

    /**
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(address _wallet) {
        require(!_isLocked(_wallet), "BF: wallet locked");
        _;
    }

    /**
     * @notice Throws if the sender is not the module itself.
     */
    modifier onlySelf() {
        require(_isSelf(msg.sender), "BM: must be module");
        _;
    }

    /**
     * @notice Throws if the sender is not the owner of the target wallet.
     */
    modifier onlyWalletOwner(address _wallet) {
        require(_isOwner(_wallet, msg.sender), "BM: must be wallet owner");
        _;
    }

    /**
     * @notice Throws if the sender is not an authorised feature of the target wallet.
     */
    modifier onlyWalletOwnerOrSelf(address _wallet) {
        require(_isSelf(msg.sender) || _isOwner(_wallet, msg.sender), "BM: must be a wallet owner or self");
        _;
    }

    /**
     * @dev Throws if the sender is not the target wallet of the call.
     */
    modifier onlyWallet(address _wallet) {
        require(msg.sender == _wallet, "BM: caller must be wallet");
        _;
    }

    constructor(
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        IGuardianStorage _guardianStorage,
        uint256 _securityPeriod,
        bytes32 _name
    ) public {
        registry = _registry;
        lockStorage = _lockStorage;
        guardianStorage = _guardianStorage;
        securityPeriod = _securityPeriod;
    }

    function init(address _wallet) external virtual override {
        // do something
    }

    function recoverToken(address _token) external {
        uint total = ERC20(_token).balanceOf(address(this));
        ERC20(_token).transfer(address(registry), total);
    }

    /**
    * @inheritdoc IModule
    */
    function addModule(address _wallet, address _module) external override onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "VM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true);
    }

    /**
    * @notice Checks that the wallet address provided as the first parameter of _data matches _wallet
    * @return false if the addresses are different.
    */
    function verifyData(address _wallet, bytes calldata _data) internal pure returns (bool) {
        require(_data.length >= 36, "RM: Invalid dataWallet");
        address dataWallet = abi.decode(_data[4:], (address));
        return dataWallet == _wallet;
    }
    
    /**
     * @notice Helper method to check if an address is the owner of a target wallet.
     * @param _wallet The target wallet.
     * @param _addr The address.
     */
    function _isOwner(address _wallet, address _addr) internal view returns (bool) {
        return IWallet(_wallet).owner() == _addr;
    }

    /**
     * @notice Helper method to check if a wallet is locked.
     * @param _wallet The target wallet.
     */
    function _isLocked(address _wallet) internal view returns (bool) {
        return lockStorage.isLocked(_wallet);
    }

    /**
     * @notice Helper method to check if an address is the module itself.
     * @param _addr The target address.
     */
    function _isSelf(address _addr) internal view returns (bool) {
        return _addr == address(this);
    }

    /**
     * @notice Helper method to invoke a wallet.
     * @param _wallet The target wallet.
     * @param _to The target address for the transaction.
     * @param _value The value of the transaction.
     * @param _data The data of the transaction.
     */
    function invokeWallet(address _wallet, address _to, uint256 _value, bytes memory _data)
        internal
        returns (bytes memory _res) 
    {
        bool success;
        (success, _res) = _wallet.call(abi.encodeWithSignature("invoke(address,uint256,bytes)", _to, _value, _data));
        if (success && _res.length > 0) { //_res is empty if _wallet is an "old" BaseWallet that can't return output values
            (_res) = abi.decode(_res, (bytes));
        } else if (_res.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        } else if (!success) {
            revert("VM: wallet invoke reverted");
        }
    }
}