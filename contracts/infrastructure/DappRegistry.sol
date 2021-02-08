pragma solidity ^0.6.12;

import "./IAuthoriser.sol";
import "./dapp/IFilter.sol";
import "./base/Owned.sol";
import "./storage/Storage.sol";

contract DappRegistry is IAuthoriser, Storage, Owned {

    bytes32 constant internal ARGENT_DEFAULT = keccak256("argent_default");

    struct Authorisation {
        bool isActive;
        address filter;
    }
    
    // mapping [wallet][name][status]
    mapping (address => mapping (bytes32 => bool)) public isEnabled;
    // mapping [name][address][authorisation]
    mapping (bytes32 => mapping (address => Authorisation)) public authorisations;

    bytes32[] public registries;

    mapping (bytes32 => address) public registryManager;

    event RegistryCreated(bytes32 registry, address manager);
    event RegistryRemoved(bytes32 registry);

    function authorise(address _wallet, address _contract, bytes calldata _data) external view override returns (bool) {
        (bool isActive, address filter) = getFilter(_wallet, _contract);
        if (isActive) {
            return _data.length == 0 || filter == address(0) || IFilter(filter).validate(_data);
        }
        return false;
    }

    function toggle(address _wallet, bytes32 _registry) external override onlyModule(_wallet) returns (bool) {
        require(_registry == ARGENT_DEFAULT || registryManager[_registry] != address(0), "AR: unknow registry");
        bool current = isEnabled[_wallet][_registry];
        isEnabled[_wallet][_registry] = !current;
        return !current;
    }

    // Do we want to let the owner to delete a registry?
    function createRegistry(bytes32 _registry, address _manager) external onlyOwner {
        require(_registry != bytes32(0) && _manager != address(0), "AR: invalid parameters");
        require(registryManager[_registry] == address(0), "AR: duplicate registry");
        registries.push(_registry);
        registryManager[_registry] = _manager;
        emit RegistryCreated(_registry, _manager);
    }

    // need to add timelock
    function addAuthorisationToRegistry(bytes32 _registry, address _contract, address _filter) external {
        if (_registry == ARGENT_DEFAULT) {
            require(msg.sender == owner, "AR: not authorised");
        } else {
            address manager = registryManager[_registry];
            require(manager != address(0), "AR: unknow registry");
            require(msg.sender == manager, "AR: not authorised");
        }
        authorisations[_registry][_contract] = Authorisation(true, _filter);
    }

    function getFilter(address _wallet, address _contract) internal view returns (bool, address) {
        // check argent default registry first (enbaled by default, i.e. false => true)
        if (!isEnabled[_wallet][ARGENT_DEFAULT] && authorisations[ARGENT_DEFAULT][_contract].isActive) {
            return (true, authorisations[ARGENT_DEFAULT][_contract].filter);
        } else {
            for (uint i = 0; i < registries.length; i++) {
                if (isEnabled[_wallet][registries[i]] && authorisations[registries[i]][_contract].isActive) {
                    return (true, authorisations[registries[i]][_contract].filter);
                }
            }
        }
        return (false, address(0));
    }
}