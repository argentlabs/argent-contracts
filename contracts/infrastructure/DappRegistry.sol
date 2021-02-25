pragma solidity ^0.6.12;

import "./IAuthoriser.sol";
import "./dapp/IFilter.sol";
import "./base/Owned.sol";
import "./storage/Storage.sol";

contract DappRegistry is IAuthoriser, Storage, Owned {

    // The timelock period
    uint64 public securityPeriod;
    // The new timelock period
    uint64 public newSecurityPeriod;
    // Time at which the new timelock becomes effective
    uint64 public securityPeriodChangeAfter;

    // bit vector of enabled registry ids for each wallet
    mapping (address => bytes32) public enabledRegistryIds; // [wallet] => [bit vector of 256 registry ids]
    // authorised dapps and their filters for each registry id
    mapping (uint8 => mapping (address => bytes32)) public authorisations; // [registryId] => [dapp] => [{filter:160}{validAfter:64}]
    // pending authorised dapps and their filters for each registry id
    mapping (uint8 => mapping (address => bytes32)) public pendingFilterUpdates; // [registryId] => [dapp] => [{filter:160}{validAfter:64}]
    // managers for each registry id
    mapping (uint8 => address) public registryManagers; // [registryId] => [manager]
    
    event RegistryCreated(uint8 registryId, address manager);
    event RegistryRemoved(uint8 registryId);
    event TimelockChangePended(uint64 newSecurityPeriod);
    event TimelockChanged(uint64 newSecurityPeriod);
    event FilterUpdated(uint8 indexed registryId, address dapp, address filter, uint256 validFrom);
    event FilterUpdatePended(uint8 indexed registryId, address dapp, address filter, uint256 validFrom);
    event DappAdded(uint8 indexed registryId, address dapp, address filter, uint256 validFrom);
    event DappRemoved(uint8 indexed registryId, address dapp);
    
    constructor(uint64 _securityPeriod) public {
        securityPeriod = _securityPeriod;
    }

    /********* Wallet-centered functions *************/

    function isEnabledRegistry(address _wallet, uint8 _registryId) external view returns (bool) {
        uint registries = uint(enabledRegistryIds[_wallet]);
        return ((registries >> _registryId) & 1) > 0;
    }

    function isAuthorised(address _wallet, address _contract, bytes calldata _data) external view override returns (bool) {
        (bool isActive, address filter) = getFilter(_wallet, _contract);
        if (isActive) {
            return _data.length == 0 || filter == address(0) || IFilter(filter).validate(_data);
        }
        return false;
    }

    function toggleRegistry(address _wallet, uint8 _registryId, bool _enabled) external override onlyModule(_wallet) returns (bool) {
        require(_registryId == 0 /* Argent Default Registry */ || registryManagers[_registryId] != address(0), "AR: unknow registry");
        uint registries = uint(enabledRegistryIds[_wallet]);
        bool current = ((registries >> _registryId) & 1) > 0;
        require(current != _enabled, "AR: bad state change" );
        enabledRegistryIds[_wallet] = bytes32(registries ^ (uint(1) << _registryId)); // toggle [_registryId]^th bit
    }

    /**************  Management of registry list  *****************/

    function createRegistry(uint8 _registryId, address _manager) external onlyOwner {
        require(_registryId > 0 && _manager != address(0), "AR: invalid parameters");
        require(registryManagers[_registryId] == address(0), "AR: duplicate registry");
        registryManagers[_registryId] = _manager;
        emit RegistryCreated(_registryId, _manager);
    }

    // Note: removeRegistry is not supported because that would allow the owner to replace registries that 
    // have already been enabled by users with a new (potentially maliciously populated) registry 

    function changeManager(uint8 _registryId, address _newManager) external {
        address manager = registryManagers[_registryId];
        require(manager != address(0), "AR: unknow registry");
        require(_newManager != address(0), "AR: new manager is 0");
        require(msg.sender == manager, "AR: sender should be manager");
        registryManagers[_registryId] = _newManager;
    }

    function requestTimelockChange(uint64 _newSecurityPeriod) external onlyOwner {
        newSecurityPeriod = _newSecurityPeriod;
        securityPeriodChangeAfter = uint64(block.timestamp) + securityPeriod;
        emit TimelockChangePended(_newSecurityPeriod);
    }

    function confirmTimelockChange() external {
        uint64 newPeriod = newSecurityPeriod;
        require(newPeriod > 0 && securityPeriodChangeAfter <= block.timestamp, "AR: can't (yet) change timelock");
        securityPeriod = newPeriod;
        newSecurityPeriod = 0;
        securityPeriodChangeAfter = 0;
        emit TimelockChanged(newPeriod);
    }

    /**************  Management of registries' content  *****************/

    function addFilter(uint8 _registryId, address _dapp, address _filter) external {
        validateManager(_registryId);
        // For dapps that have _not_ previously been authorised or that have previously been authorised _without_ a filter, 
        // we can update the filter immediately as the addition of a filter necessarily makes the authorisation _more_ restrictive.
        uint auth = uint(authorisations[_registryId][_dapp]); // {filter:160}{validFrom:64}
        require((auth >> 64) == 0, "DR: filter already set");
        uint validFrom = auth & 0xffffffffffffffff;
        if(validFrom == 0)  { // this is a newly authorised dapp
            validFrom = block.timestamp + securityPeriod;
            emit DappAdded(_registryId, _dapp, _filter, validFrom);
        } else {
            emit FilterUpdated(_registryId, _dapp, _filter, validFrom);
        }
        // Store the new authorisation as {filter:160}{validFrom:64}
        authorisations[_registryId][_dapp] = bytes32((uint(uint160(_filter)) << 64) | validFrom);
    }

    function requestFilterUpdate(uint8 _registryId, address _dapp, address _filter) external {
        validateManager(_registryId);
        // For dapps that have previously been authorised _with_ a filter, we cannot immediately override
        // the existing filter and need to store the new filter for a security period before being able
        // to change the filter
        uint auth = uint(authorisations[_registryId][_dapp]); // {filter:160}{validFrom:64}
        require((auth >> 64) > 0, "AR: should use addFilter()");
        uint validFrom = block.timestamp + securityPeriod;
        // Store the future authorisation as {filter:160}{validFrom:64}
        pendingFilterUpdates[_registryId][_dapp] = bytes32((uint(uint160(_filter)) << 64) | validFrom);
        emit FilterUpdatePended(_registryId, _dapp, _filter, validFrom);
    }

    function confirmFilterUpdate(uint8 _registryId, address _dapp) external {
        uint newAuth = uint(pendingFilterUpdates[_registryId][_dapp]);
        require(newAuth > 0, "AR: no pending filter update");
        uint validFrom = newAuth & 0xffffffffffffffff;
        require(validFrom <= block.timestamp, "AR: too early to confirm auth");
        pendingFilterUpdates[_registryId][_dapp] = bytes32(newAuth);
        emit FilterUpdated(_registryId, _dapp, address(uint160(newAuth >> 64)), validFrom); 
        delete pendingFilterUpdates[_registryId][_dapp];
    }

    function removeDapp(uint8 _registryId, address _dapp) external {
        validateManager(_registryId);
        require(authorisations[_registryId][_dapp] != bytes32(0), "AR: unknown dapp");
        delete authorisations[_registryId][_dapp];
        emit DappRemoved(_registryId, _dapp);
    }

    /********  Internal Functions ***********/

    function validateManager(uint8 _registryId) internal {
        if (_registryId == 0) { // Argent Default Registry
            require(msg.sender == owner, "AR: sender should be owner");
        } else { // Community Registry
            address manager = registryManagers[_registryId];
            require(manager != address(0), "AR: unknow registry");
            require(msg.sender == manager, "AR: sender should be manager");
        }
    }

    function getFilter(address _wallet, address _dapp) internal view returns (bool, address) {
        uint registries = uint(enabledRegistryIds[_wallet]);
        // Check Argent Default Registry first. It is enabled by default, implying that a zero 
        // at position 0 of the `registries` bit vector means that the Argent Registry is enabled)
        for(uint registryId = 0; registryId == 0 || (registries >> registryId) > 0; registryId++) {
            bool isEnabled = (((registries >> registryId) & 1) > 0) /* "is bit set for regId?" */ == (registryId > 0) /* "not Argent registry?" */;
            if(isEnabled) { // if registryId is enabled
                uint auth = uint(authorisations[uint8(registryId)][_dapp]); 
                uint validAfter = auth & 0xffffffffffffffff;
                if (0 < validAfter && validAfter <= block.timestamp) { // if the current time is greater than the validity time
                    return (true, address(uint160(auth >> 64))); // return the filter stored for _dapp
                }
            }
        }
        
        return (false, address(0));
    }
}