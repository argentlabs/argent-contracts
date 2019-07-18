pragma solidity ^0.5.4;
import "../../base/Owned.sol";
import "../../wallet/BaseWallet.sol";
import "./BaseModule.sol";

/**
 * @title ProviderModule
 * @dev Module that can delegate the execution of a call to a set of providers satisfying a common interface.
 * Only the owner of the Module can register providers. 
 * @author Julien Niset - <julien@argent.im>
 */
contract ProviderModule is BaseModule, Owned {

    // providers supported by the wallet [wallet][provider] => Provider
    mapping (address => mapping(address => Provider)) public providers;
    // providers supported by default (added in Module.init()) [provider] => Provider
    mapping(address => Provider) public defaultProviders;
    // providers supported by default (as an array)
    address[] public allDefaultProviders;

    struct Provider {
        bool exists;
        address[] oracles;
    }

    constructor(ModuleRegistry _registry, bytes32 _name)
        BaseModule(_registry, _name)
        public
    {
    }

    /**
     * @dev Inits the module for a wallet by adding all default providers
     * @param _wallet The target wallet.
     */
    function init(BaseWallet _wallet) external onlyWallet(_wallet) {
        for(uint i = 0; i < allDefaultProviders.length; i++) {
            address provider = allDefaultProviders[i];
            providers[address(_wallet)][provider] = Provider(true, defaultProviders[provider].oracles);
        }
    }

    function addDefaultProvider(address _provider, address[] calldata _oracles)
        external
        onlyOwner
    {
        require(!defaultProviders[_provider].exists, "PM: Provider already added");
        defaultProviders[_provider] = Provider(true, _oracles);
        allDefaultProviders.push(_provider);
    }

    function addProvider(BaseWallet _wallet, address _provider, address[] calldata _oracles)
        external
        onlyWalletOwner(_wallet)
    {
        providers[address(_wallet)][_provider] = Provider(true, _oracles);
    }

    function removeProvider(BaseWallet _wallet, address _provider)
        external
        onlyWalletOwner(_wallet)
    {
        delete providers[address(_wallet)][_provider];
    }

    function isProvider(BaseWallet _wallet, address _provider) public view returns (bool) {
        return providers[address(_wallet)][_provider].exists;
    }

    function getProviderOracles(BaseWallet _wallet, address _provider) public view returns (address[] memory) {
        return providers[address(_wallet)][_provider].oracles;
    }

    function delegateToProvider(BaseWallet _wallet, address _provider, bytes memory _methodData) internal returns (bool, bytes memory) {
        require(isProvider(_wallet, _provider), "ProviderModule: Invalid provider");
        return _provider.delegatecall(_methodData);
    }
}