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

import "../wallet/Proxy.sol";
import "../wallet/BaseWallet.sol";
import "./base/Owned.sol";
import "./base/ManagedV2.sol";
import "./storage/IGuardianStorage.sol";
import "../modules/common/IVersionManager.sol";
import "../modules/common/Utils.sol";

/**
 * @title WalletFactory
 * @notice The WalletFactory contract creates and assigns wallets to accounts.
 * @author Julien Niset, Olivier VDB - <julien@argent.xyz>, <olivier@argent.xyz>
 */
contract WalletFactory is ManagedV2 {

    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The address of the base wallet implementation
    address public walletImplementation;
    // The address of the GuardianStorage
    address public guardianStorage;
    // The recipient of the refund
    address public refundAddress; 
    // The managers
    mapping (address => bool) public managers;

    // *************** Events *************************** //

    event RefundAddressChanged(address addr);
    event WalletCreated(address indexed wallet, address indexed owner, address indexed guardian, address refundToken, uint256 refundAmount);
    event ManagerAdded(address indexed _manager);

    // *************** Constructor ********************** //

    /**
     * @notice Default constructor.
     */
    constructor(address _walletImplementation, address _guardianStorage, address _refundAddress) public {
        
        require(_walletImplementation != address(0), "WF: WalletImplementation address not defined");
        require(_guardianStorage != address(0), "WF: GuardianStorage address not defined");
        require(_refundAddress != address(0), "WF: refund address not defined");
        walletImplementation = _walletImplementation;
        guardianStorage = _guardianStorage;
        refundAddress = _refundAddress;
    }

    // *************** External Functions ********************* //

    /**
    * @notice Revokes a manager (unused).
    * @param _manager The address of the manager.
    */
    function revokeManager(address _manager) override external {
        revert("WF: managers can't be revoked");
    }
     
    /**
     * @notice Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with the version manager module, the version number and a first guardian.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @param _version The version of the feature bundle.
     * @param _r The r part of a manager's signature
     * @param _s The s part of a manager's signature
     * @param _v The v part of a manager's signature
     */
    function createCounterfactualWallet(
        address _owner,
        address _versionManager,
        address _guardian,
        bytes20 _salt,
        uint256 _version,
        uint256 _refundAmount,
        address _refundToken,
        bytes calldata _ownerSignature
        bytes32 _r,
        bytes32 _s,
        uint8 _v
    )
        external
        returns (address _wallet)
    {
        validateInputs(_owner, _versionManager, _guardian, _version);
        bytes32 newsalt = newSalt(_salt, _owner, _versionManager, _guardian, _version);
        Proxy proxy = new Proxy{salt: newsalt}(walletImplementation);
        address payable wallet = address(proxy);
        validateAuthorisedCreation(wallet, _r, _s, _v);
        configureWallet(BaseWallet(wallet), _owner, _versionManager, _guardian, _version);
        if (_refundAmount > 0 && _ownerSignature.length == 65) {
            validateAndRefund(wallet, _owner, _refundAmount, _refundToken, _ownerSignature);
        }
        // remove the factory from the authorised modules
        BaseWallet(wallet).authoriseModule(address(this), false);

        // emit event
        emit WalletCreated(wallet, _owner, _guardian, _refundToken, _refundAmount);

        return wallet;
    }

    /**
     * @notice Gets the address of a counterfactual wallet with a first default guardian.
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @param _version The version of feature bundle.
     * @return _wallet The address that the wallet will have when created using CREATE2 and the same input parameters.
     */
    function getAddressForCounterfactualWallet(
        address _owner,
        address _versionManager,
        address _guardian,
        bytes20 _salt,
        uint256 _version
    )
        external
        view
        returns (address _wallet)
    {
        validateInputs(_owner, _versionManager, _guardian, _version);
        bytes32 newsalt = newSalt(_salt, _owner, _versionManager, _guardian, _version);
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
    }

    /**
     * @notice Lets the owner change the refund address.
     * @param _refundAddress The address to use for refunds.
     */
    function changeRefundAddress(address _refundAddress) external onlyOwner {
        require(_refundAddress != address(0), "WF: address cannot be null");
        refundAddress = _refundAddress;
        emit RefundAddressChanged(_refundAddress);
    }

    /**
     * @notice Inits the module for a wallet by doing nothing.
     * The method can only be called by the wallet itself.
     * @param _wallet The wallet.
     */
    function init(BaseWallet _wallet) external pure {
        //do nothing
    }

    // *************** Internal Functions ********************* //

    /**
     * @notice Helper method to configure a wallet for a set of input parameters.
     * @param _wallet The target wallet
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address.
     * @param _version The version of the feature bundle.
     */
    function configureWallet(
        BaseWallet _wallet,
        address _owner,
        address _versionManager,
        address _guardian,
        uint256 _version
    )
        internal
    {
        // add the factory to modules so it can add a guardian and upgrade the wallet to the required version
        address[] memory extendedModules = new address[](2);
        extendedModules[0] = _versionManager;
        extendedModules[1] = address(this);

        // initialise the wallet with the owner and the extended modules
        _wallet.init(_owner, extendedModules);

        // add guardian
        IGuardianStorage(guardianStorage).addGuardian(address(_wallet), _guardian);

        // upgrade the wallet
        IVersionManager(_versionManager).upgradeWallet(address(_wallet), _version);
    }

    /**
     * @notice Generates a new salt based on a provided salt, an owner, a list of modules and an optional guardian.
     * The extra parameters are pre-hashed to be compatible with zk-sync CREATE2 API (!! the order of the parameters 
     * assumes https://github.com/matter-labs/zksync/pull/259 has been merged !!).
     * @param _salt The salt provided. In practice the hash of the L2 public key.
     * @param _owner The owner address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address.
     * @param _version The version of feature bundle
     */
    function newSalt(bytes20 _salt, address _owner, address _versionManager, address _guardian, uint256 _version) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encodePacked(_owner, _versionManager, _guardian, _version)), _salt));
    }

    /**
     * @notice Throws if the owner, guardian, version or version manager is invalid.
     * @param _owner The owner address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address
     * @param _version The version of feature bundle
     */
    function validateInputs(address _owner, address _versionManager, address _guardian, uint256 _version) internal pure {
        require(_owner != address(0), "WF: owner cannot be null");
        require(_owner != _guardian, "WF: owner cannot be guardian");
        require(_versionManager != address(0), "WF: invalid _versionManager");
        require(_guardian != (address(0)), "WF: guardian cannot be null");
        require(_version > 0, "WF: invalid _version");
    }

    /**
     * @notice Refunds the creation of the wallet when provided with a valid signature from the wallet owner.
     * @param _wallet The wallet created
     * @param _owner The owner address
     * @param _refundAmount The amount to refund
     * @param _refundToken The token to use for the refund
     * @param _ownerSignature A signature from the wallet owner approving the refund amount and token. 
     */
    function validateAndRefund(
        address _wallet,
        address _owner,
        uint256 _refundAmount,
        address _refundToken,
        bytes memory _ownerSignature
    )
        internal
    {
        bytes32 signedHash = keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(_refundAmount, _refundToken))
            ));
        address signer = Utils.recoverSigner(signedHash, _ownerSignature, 0);
        if (signer == _owner) {
            if (_refundToken == ETH_TOKEN) {
                invokeWallet(_wallet, refundAddress, _refundAmount, "");
            } else {
                bytes memory methodData = abi.encodeWithSignature("transfer(address,uint256)", refundAddress, _refundAmount);
                bytes memory transferSuccessBytes = invokeWallet(_wallet, _refundToken, 0, methodData);
                if (transferSuccessBytes.length > 0) {
                    require(abi.decode(transferSuccessBytes, (bool)), "WF: Refund transfer failed");
                }
            }
        }
    }

    /**
     * @notice Invoke the wallet to execute the refund transfer.
     * @param _wallet The wallet
     * @param _to The destination of the call
     * @param _value The value of the call
     * @param _data The data associated to the call
     */
    function invokeWallet(
        address _wallet,
        address _to,
        uint256 _value,
        bytes memory _data
    )
        internal
        returns (bytes memory _res)
    {
        bool success;
        (success, _res) = _wallet.call(abi.encodeWithSignature("invoke(address,uint256,bytes)", _to, _value, _data));
        if (success) {
            (_res) = abi.decode(_res, (bytes));
        } else {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
    
    /**
     * @notice Throws if the sender is not a manager and the manager's signature for the
     * creation of the new wallet is invalid.
     * @param _wallet The wallet address
     * @param _r The r part of a manager's signature
     * @param _s The s part of a manager's signature
     * @param _v The v part of a manager's signature
     */
    function validateAuthorisedCreation(
        address _wallet,
        bytes32 _r,
        bytes32 _s,
        uint8 _v
    ) internal view {
        address manager;
        if(uint256(_r) == 0) {
            manager = msg.sender;
        } else {
            manager = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", bytes32(uint256(_wallet)))), _v, _r, _s);
        }
        require(managers[manager], "WF: unauthorised wallet creation");
    }

}
