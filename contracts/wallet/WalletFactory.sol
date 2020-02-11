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
import "../ens/ENSConsumer.sol";
import "../ens/IENSManager.sol";
import "../upgrade/ModuleRegistry.sol";

/**
 * @title WalletFactory
 * @dev The WalletFactory contract creates and assigns wallets to accounts.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract WalletFactory is Owned, Managed, ENSConsumer {

    // The address of the module dregistry
    address public moduleRegistry;
    // The address of the base wallet implementation
    address public walletImplementation;
    // The address of the ENS manager
    address public ensManager;
    // The address of the ENS resolver
    address public ensResolver;

    // *************** Events *************************** //

    event ModuleRegistryChanged(address addr);
    event WalletImplementationChanged(address addr);
    event ENSManagerChanged(address addr);
    event ENSResolverChanged(address addr);
    event WalletCreated(address indexed _wallet, address indexed _owner);

    // *************** Constructor ********************** //

    /**
     * @dev Default constructor.
     */
    constructor(
        address _ensRegistry, 
        address _moduleRegistry,
        address _walletImplementation, 
        address _ensManager, 
        address _ensResolver
    ) 
        ENSConsumer(_ensRegistry) 
        public 
    {
        moduleRegistry = _moduleRegistry;
        walletImplementation = _walletImplementation;
        ensManager = _ensManager;
        ensResolver = _ensResolver;
    }

    // *************** External Functions ********************* //

    /**
     * @dev Lets the manager create a wallet for an account. The wallet is initialised with a list of modules.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label Optional ENS label of the new wallet (e.g. franck).
     */
    function createWallet(address _owner, address[] calldata _modules, string calldata _label) external onlyManager {
        require(_owner != address(0), "WF: owner cannot be null");
        require(_modules.length > 0, "WF: cannot assign with less than 1 module");
        require(ModuleRegistry(moduleRegistry).isRegisteredModule(_modules), "WF: one or more modules are not registered");
        // create the proxy
        Proxy proxy = new Proxy(walletImplementation);
        address payable wallet = address(proxy);
        // check for ENS
        bytes memory labelBytes = bytes(_label);
        if (labelBytes.length != 0) {
            // add the factory to the modules so it can claim the reverse ENS
            address[] memory extendedModules = new address[](_modules.length + 1);
            extendedModules[0] = address(this);
            for(uint i = 0; i < _modules.length; i++) {
                extendedModules[i + 1] = _modules[i];
            }
            // initialise the wallet with the owner and the extended modules
            BaseWallet(wallet).init(_owner, extendedModules);
            // register ENS
            registerWalletENS(wallet, _label);
            // remove the factory from the authorised modules
            BaseWallet(wallet).authoriseModule(address(this), false);
        } else {
            // initialise the wallet with the owner and the modules
            BaseWallet(wallet).init(_owner, _modules);
        }
        emit WalletCreated(wallet, _owner);
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
     * @dev Lets the owner change the address of the implementing contract.
     * @param _walletImplementation The address of the implementing contract.
     */
    function changeWalletImplementation(address _walletImplementation) external onlyOwner {
        require(_walletImplementation != address(0), "WF: address cannot be null");
        walletImplementation = _walletImplementation;
        emit WalletImplementationChanged(_walletImplementation);
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
     * @dev Lets the owner change the address of the ENS resolver contract.
     * @param _ensResolver The address of the ENS resolver contract.
     */
    function changeENSResolver(address _ensResolver) external onlyOwner {
        require(_ensResolver != address(0), "WF: address cannot be null");
        ensResolver = _ensResolver;
        emit ENSResolverChanged(_ensResolver);
    }

    /**
     * @dev Register an ENS subname to a wallet.
     * @param _wallet The wallet address.
     * @param _label ENS label of the new wallet (e.g. franck).
     */
    function registerWalletENS(address payable _wallet, string memory _label) internal {
        // claim reverse
        bytes memory methodData = abi.encodeWithSignature("claimWithResolver(address,address)", ensManager, ensResolver);
        BaseWallet(_wallet).invoke(address(getENSReverseRegistrar()), 0, methodData);
        // register with ENS manager
        IENSManager(ensManager).register(_label, _wallet);
    }

    /**
     * @dev Inits the module for a wallet by logging an event.
     * The method can only be called by the wallet itself.
     * @param _wallet The wallet.
     */
    function init(BaseWallet _wallet) external pure {
        //do nothing
    }
}
