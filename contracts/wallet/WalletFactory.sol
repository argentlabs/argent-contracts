pragma solidity ^0.5.4;
import "./Proxy.sol";
import "./BaseWallet.sol";
import "../base/Owned.sol";
import "../base/Managed.sol";
import "../ens/ENSConsumer.sol";
import "../ens/ArgentENSManager.sol";
import "../upgrade/ModuleRegistry.sol";

interface IGuardianStorage{
    function addGuardian(BaseWallet _wallet, address _guardian) external;
}

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
    // The address of the GuardianStorage
    address public guardianStorage;

    // *************** Events *************************** //

    event ModuleRegistryChanged(address addr);
    event ENSManagerChanged(address addr);
    event ENSResolverChanged(address addr);
    event GuardianStorageChanged(address addr);
    event WalletCreated(address indexed wallet, address indexed owner, address indexed guardian);

    // *************** Constructor ********************** //

    /**
     * @dev Default constructor.
     */
    constructor(
        address _ensRegistry,
        address _moduleRegistry,
        address _walletImplementation,
        address _ensManager,
        address _ensResolver,
        address _guardianStorage
    )
        ENSConsumer(_ensRegistry)
        public
    {
        moduleRegistry = _moduleRegistry;
        walletImplementation = _walletImplementation;
        ensManager = _ensManager;
        ensResolver = _ensResolver;
        guardianStorage = _guardianStorage;
    }

    // *************** External Functions ********************* //

    /**
     * @dev Lets the manager create a wallet for an owner account.
     * The wallet is initialised with a list of modules and an optional ENS..
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label (Optional) ENS label of the new wallet, e.g. franck.
     */
    function createWallet(
        address _owner,
        address[] calldata _modules,
        string calldata _label
    )
        external
        onlyManager
    {
        Proxy proxy = new Proxy(walletImplementation);
        address payable wallet = address(proxy);
        configureWallet(BaseWallet(wallet), _owner, _modules, _label, address(0));
    }

    /**
     * @dev Lets the manager create a wallet for an owner account.
     * The wallet is initialised with a list of modules, a first guardian, and an optional ENS..
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label (Optional) ENS label of the new wallet, e.g. franck.
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
    {
        Proxy proxy = new Proxy(walletImplementation);
        address payable wallet = address(proxy);
        configureWallet(BaseWallet(wallet), _owner, _modules, _label, _guardian);
    }

    /**
     * @dev Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with a list of modules and an optional ENS.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label (Optional) ENS label of the new wallet, e.g. franck.
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
        bytes32 newsalt = keccak256(abi.encodePacked(_salt, _owner, _modules));
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        address payable wallet;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            wallet := create2(0, add(code, 0x20), mload(code), newsalt)
            if iszero(extcodesize(wallet)) { revert(0, returndatasize) }
        }
        configureWallet(BaseWallet(wallet), _owner, _modules, _label, address(0));
    }

    /**
     * @dev Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with a list of modules, a first guardian, and an optional ENS.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label (Optional) ENS label of the new wallet, e.g. franck.
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
    {
        bytes32 newsalt = keccak256(abi.encodePacked(_salt, _owner, _modules));
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        address payable wallet;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            wallet := create2(0, add(code, 0x20), mload(code), newsalt)
            if iszero(extcodesize(wallet)) { revert(0, returndatasize) }
        }
        configureWallet(BaseWallet(wallet), _owner, _modules, _label, _guardian);
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
        bytes32 newsalt = keccak256(abi.encodePacked(_salt, _owner, _modules));
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
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
     * @dev Lets the owner change the address of the ENS resolver contract.
     * @param _ensResolver The address of the ENS resolver contract.
     */
    function changeENSResolver(address _ensResolver) external onlyOwner {
        require(_ensResolver != address(0), "WF: address cannot be null");
        ensResolver = _ensResolver;
        emit ENSResolverChanged(_ensResolver);
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
     * @dev Helper method to configure a wallet for a set of input parameters.
     * @param _wallet The target wallet
     * @param _owner The account address.
     * @param _modules The list of modules.
     * @param _label (Optional) The ENS label, e.g. franck.
     * @param _guardian (Optional) The guardian address.
     */
    function configureWallet(
        BaseWallet _wallet,
        address _owner,
        address[] memory _modules,
        string memory _label,
        address _guardian
    )
        internal
    {
        require(_owner != address(0), "WF: owner cannot be null");
        require(_modules.length > 0, "WF: cannot assign with less than 1 module");
        require(ModuleRegistry(moduleRegistry).isRegisteredModule(_modules), "WF: one or more modules are not registered");
        // add the factory to modules so it can claim the reverse ENS or add a guardian
        address[] memory extendedModules = new address[](_modules.length + 1);
        extendedModules[0] = address(this);
        for(uint i = 0; i < _modules.length; i++) {
            extendedModules[i + 1] = _modules[i];
        }
        // initialise the wallet with the owner and the extended modules
        _wallet.init(_owner, extendedModules);
        // add guardian if needed
        if(_guardian != address(0)) {
            IGuardianStorage(guardianStorage).addGuardian(_wallet, _guardian);
        }
        // register ENS if needed
        bytes memory labelBytes = bytes(_label);
        if (labelBytes.length != 0) {
            registerWalletENS(address(_wallet), _label);
        }
        // remove the factory from the authorised modules
        _wallet.authoriseModule(address(this), false);
        // emit event
        emit WalletCreated(address(_wallet), _owner, _guardian);
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
