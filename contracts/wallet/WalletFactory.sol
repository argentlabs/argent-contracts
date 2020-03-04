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
import "./Proxy.sol";
import "./BaseWallet.sol";
import "../base/Owned.sol";
import "../base/Managed.sol";
import "../ens/IENSManager.sol";
import "../upgrade/ModuleRegistry.sol";
import "../storage/IGuardianStorage.sol";

/**
 * @title WalletFactory
 * @dev The WalletFactory contract creates and assigns wallets to accounts.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract WalletFactory is Owned, Managed {

    // The address of the module dregistry
    address public moduleRegistry;
    // The address of the base wallet implementation
    address public walletImplementation;
    // The address of the ENS manager
    address public ensManager;
    // The address of the GuardianStorage
    address public guardianStorage;

    // *************** Events *************************** //

    event ModuleRegistryChanged(address addr);
    event ENSManagerChanged(address addr);
    event GuardianStorageChanged(address addr);
    event WalletCreated(address indexed wallet, address indexed owner, address indexed guardian);

    // *************** Modifiers *************************** //

    /**
     * @dev Throws if the guardian storage address is not set.
     */
    modifier guardianStorageDefined {
        require(guardianStorage != address(0), "GuardianStorage address not defined");
        _;
    }

    // *************** Constructor ********************** //

    /**
     * @dev Default constructor.
     */
    constructor(address _moduleRegistry, address _walletImplementation, address _ensManager) public {
        moduleRegistry = _moduleRegistry;
        walletImplementation = _walletImplementation;
        ensManager = _ensManager;
    }

    // *************** External Functions ********************* //

    /**
     * @dev Lets the manager create a wallet for an owner account.
     * The wallet is initialised with a list of modules and an ENS..
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     */
    function createWallet(
        address _owner,
        address[] calldata _modules,
        string calldata _label
    )
        external
        onlyManager
    {
        _createWallet(_owner, _modules, _label, address(0));
    }

    /**
     * @dev Lets the manager create a wallet for an owner account.
     * The wallet is initialised with a list of modules, a first guardian, and an ENS..
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     * @param _guardian The guardian address.
     */
    function createWalletWithGuardian(
        address _owner,
        address[] calldata _modules,
        string calldata _label,
        address _guardian
    )
        external
        onlyManager
        guardianStorageDefined
    {
        require(_guardian != (address(0)), "WF: guardian cannot be null");
        _createWallet(_owner, _modules, _label, _guardian);
    }

    /**
     * @dev Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with a list of modules and an ENS.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     * @param _salt The salt.
     */
    function createCounterfactualWallet(
        address _owner,
        address[] calldata _modules,
        string calldata _label,
        bytes32 _salt
    )
        external
        onlyManager
    {
        _createCounterfactualWallet(_owner, _modules, _label, address(0), _salt);
    }

    /**
     * @dev Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with a list of modules, a first guardian, and an ENS.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     * @param _guardian The guardian address.
     * @param _salt The salt.
     */
    function createCounterfactualWalletWithGuardian(
        address _owner,
        address[] calldata _modules,
        string calldata _label,
        address _guardian,
        bytes32 _salt
    )
        external
        onlyManager
        guardianStorageDefined
    {
        require(_guardian != (address(0)), "WF: guardian cannot be null");
        _createCounterfactualWallet(_owner, _modules, _label, _guardian, _salt);
    }

    /**
     * @dev Gets the address of a counterfactual wallet.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _salt The salt.
     * @return the address that the wallet will have when created using CREATE2 and the same input parameters.
     */
    function getAddressForCounterfactualWallet(
        address _owner,
        address[] calldata _modules,
        bytes32 _salt
    )
        external
        view
        returns (address _wallet)
    {
        _wallet = _getAddressForCounterfactualWallet(_owner, _modules, address(0), _salt);
    }

    /**
     * @dev Gets the address of a counterfactual wallet with a first default guardian.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @return the address that the wallet will have when created using CREATE2 and the same input parameters.
     */
    function getAddressForCounterfactualWalletWithGuardian(
        address _owner,
        address[] calldata _modules,
        address _guardian,
        bytes32 _salt
    )
        external
        view
        returns (address _wallet)
    {
        require(_guardian != (address(0)), "WF: guardian cannot be null");
        _wallet = _getAddressForCounterfactualWallet(_owner, _modules, _guardian, _salt);
    }

    /**
     * @dev Lets the owner change the address of the module registry contract.
     * @param _moduleRegistry The address of the module registry contract.
     */
    function changeModuleRegistry(address _moduleRegistry) external onlyOwner {
        require(_moduleRegistry != address(0), "WF: address cannot be null");
        moduleRegistry = _moduleRegistry;
        emit ModuleRegistryChanged(_moduleRegistry);
    }

    /**
     * @dev Lets the owner change the address of the ENS manager contract.
     * @param _ensManager The address of the ENS manager contract.
     */
    function changeENSManager(address _ensManager) external onlyOwner {
        require(_ensManager != address(0), "WF: address cannot be null");
        ensManager = _ensManager;
        emit ENSManagerChanged(_ensManager);
    }

    /**
     * @dev Lets the owner change the address of the GuardianStorage contract.
     * @param _guardianStorage The address of the GuardianStorage contract.
     */
    function changeGuardianStorage(address _guardianStorage) external onlyOwner {
        require(_guardianStorage != address(0), "WF: address cannot be null");
        guardianStorage = _guardianStorage;
        emit GuardianStorageChanged(_guardianStorage);
    }

    /**
     * @dev Inits the module for a wallet by logging an event.
     * The method can only be called by the wallet itself.
     * @param _wallet The wallet.
     */
    function init(BaseWallet _wallet) external pure { // solium-disable-line no-empty-blocks
        //do nothing
    }

    // *************** Internal Functions ********************* //

    /**
     * @dev Helper method to create a wallet for an owner account.
     * The wallet is initialised with a list of modules, a first guardian, and an ENS.
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     * @param _guardian (Optional) The guardian address.
     */
    function _createWallet(address _owner, address[] memory _modules, string memory _label, address _guardian) internal {
        _validateInputs(_owner, _modules, _label);
        Proxy proxy = new Proxy(walletImplementation);
        address payable wallet = address(proxy);
        _configureWallet(BaseWallet(wallet), _owner, _modules, _label, _guardian);
    }

    /**
     * @dev Helper method to create a wallet for an owner account at a specific address.
     * The wallet is initialised with a list of modules, a first guardian, and an ENS.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     * @param _guardian The guardian address.
     * @param _salt The salt.
     */
    function _createCounterfactualWallet(
        address _owner,
        address[] memory _modules,
        string memory _label,
        address _guardian,
        bytes32 _salt
    )
        internal
    {
        _validateInputs(_owner, _modules, _label);
        bytes32 newsalt = _newSalt(_salt, _owner, _modules, _guardian);
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        address payable wallet;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            wallet := create2(0, add(code, 0x20), mload(code), newsalt)
            if iszero(extcodesize(wallet)) { revert(0, returndatasize) }
        }
        _configureWallet(BaseWallet(wallet), _owner, _modules, _label, _guardian);
    }

    /**
     * @dev Helper method to configure a wallet for a set of input parameters.
     * @param _wallet The target wallet
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label ENS label of the new wallet, e.g. franck.
     * @param _guardian (Optional) The guardian address.
     */
    function _configureWallet(
        BaseWallet _wallet,
        address _owner,
        address[] memory _modules,
        string memory _label,
        address _guardian
    )
        internal
    {
        // add the factory to modules so it can claim the reverse ENS or add a guardian
        address[] memory extendedModules = new address[](_modules.length + 1);
        extendedModules[0] = address(this);
        for (uint i = 0; i < _modules.length; i++) {
            extendedModules[i + 1] = _modules[i];
        }
        // initialise the wallet with the owner and the extended modules
        _wallet.init(_owner, extendedModules);
        // add guardian if needed
        if (_guardian != address(0)) {
            IGuardianStorage(guardianStorage).addGuardian(_wallet, _guardian);
        }
        // register ENS
        _registerWalletENS(address(_wallet), _label);
        // remove the factory from the authorised modules
        _wallet.authoriseModule(address(this), false);
        // emit event
        emit WalletCreated(address(_wallet), _owner, _guardian);
    }

    /**
     * @dev Gets the address of a counterfactual wallet.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _salt The salt.
     * @param _guardian (Optional) The guardian address.
     * @return the address that the wallet will have when created using CREATE2 and the same input parameters.
     */
    function _getAddressForCounterfactualWallet(
        address _owner,
        address[] memory _modules,
        address _guardian,
        bytes32 _salt
    )
        internal
        view
        returns (address _wallet)
    {
        bytes32 newsalt = _newSalt(_salt, _owner, _modules, _guardian);
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
    }

    /**
     * @dev Generates a new salt based on a provided salt, an owner, a list of modules and an optional guardian.
     * @param _salt The slat provided.
     * @param _owner The owner address.
     * @param _modules The list of modules.
     * @param _guardian The guardian address.
     */
    function _newSalt(bytes32 _salt, address _owner, address[] memory _modules, address _guardian) internal pure returns (bytes32) {
        if (_guardian == address(0)) {
            return keccak256(abi.encodePacked(_salt, _owner, _modules));
        } else {
            return keccak256(abi.encodePacked(_salt, _owner, _modules, _guardian));
        }
    }

    /**
     * @dev Throws if the owner and the modules are not valid.
     * @param _owner The owner address.
     * @param _modules The list of modules.
     */
    function _validateInputs(address _owner, address[] memory _modules, string memory _label) internal view {
        require(_owner != address(0), "WF: owner cannot be null");
        require(_modules.length > 0, "WF: cannot assign with less than 1 module");
        require(ModuleRegistry(moduleRegistry).isRegisteredModule(_modules), "WF: one or more modules are not registered");
        bytes memory labelBytes = bytes(_label);
        require(labelBytes.length != 0, "WF: ENS lable must be defined");
    }

    /**
     * @dev Register an ENS subname to a wallet.
     * @param _wallet The wallet address.
     * @param _label ENS label of the new wallet (e.g. franck).
     */
    function _registerWalletENS(address payable _wallet, string memory _label) internal {
        // claim reverse
        address ensResolver = IENSManager(ensManager).ensResolver();
        bytes memory methodData = abi.encodeWithSignature("claimWithResolver(address,address)", ensManager, ensResolver);
        address ensReverseRegistrar = IENSManager(ensManager).getENSReverseRegistrar();
        BaseWallet(_wallet).invoke(ensReverseRegistrar, 0, methodData);
        // register with ENS manager
        IENSManager(ensManager).register(_label, _wallet);
    }
}
