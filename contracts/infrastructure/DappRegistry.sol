pragma solidity ^0.6.12;

import "./IAuthoriser.sol";
import "./dapp/IFilter.sol";
import "./storage/Storage.sol";

contract DappRegistry is IAuthoriser, Storage {

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
    // owners for each registry id
    mapping (uint8 => address) public registryOwners; // [registryId] => [owner]
    
    event RegistryCreated(uint8 registryId, address registryOwner);
    event RegistryRemoved(uint8 registryId);
    event OwnerChanged(uint8 registryId, address newRegistryOwner);
    event TimelockChangeRequested(uint64 newSecurityPeriod);
    event TimelockChanged(uint64 newSecurityPeriod);
    event FilterUpdated(uint8 indexed registryId, address dapp, address filter, uint256 validFrom);
    event FilterUpdateRequested(uint8 indexed registryId, address dapp, address filter, uint256 validFrom);
    event DappAdded(uint8 indexed registryId, address dapp, address filter, uint256 validFrom);
    event DappRemoved(uint8 indexed registryId, address dapp);

    modifier onlyOwner(uint8 _registryId) {
        validateOwner(_registryId);
        _;
    }
    
    constructor(uint64 _securityPeriod) public {
        // set the timelock period
        securityPeriod = _securityPeriod;
        // set the owner of the Argent Registry (registryId == 0)
        registryOwners[0] = msg.sender;
    }

    /********* Wallet-centered functions *************/

    function isEnabledRegistry(address _wallet, uint8 _registryId) external view returns (bool) {
        uint registries = uint(enabledRegistryIds[_wallet]);
        return ((registries >> _registryId) & 1) > 0;
    }

    function isAuthorised(address _wallet, address _spender, address _to, bytes calldata _data) external view override returns (bool) {
        (bool isActive, address filter) = getFilter(_wallet, _spender);
        if (isActive) {
            return _data.length == 0 || filter == address(0) || IFilter(filter).validate(_spender, _to, _data);
        }
        return false;
    }

    function toggleRegistry(address _wallet, uint8 _registryId, bool _enabled) external override onlyModule(_wallet) returns (bool) {
        require(registryOwners[_registryId] != address(0), "AR: unknown registry");
        uint registries = uint(enabledRegistryIds[_wallet]);
        bool current = ((registries >> _registryId) & 1) > 0;
        require(current != _enabled, "AR: bad state change" );
        enabledRegistryIds[_wallet] = bytes32(registries ^ (uint(1) << _registryId)); // toggle [_registryId]^th bit
    }

    /**************  Management of registry list  *****************/

    function createRegistry(uint8 _registryId, address _registryOwner) external onlyOwner(0) {
        require(_registryOwner != address(0), "AR: registry owner is 0");
        require(registryOwners[_registryId] == address(0), "AR: duplicate registry");
        registryOwners[_registryId] = _registryOwner;
        emit RegistryCreated(_registryId, _registryOwner);
    }

    // Note: removeRegistry is not supported because that would allow the owner to replace registries that 
    // have already been enabled by users with a new (potentially maliciously populated) registry 

    function changeOwner(uint8 _registryId, address _newRegistryOwner) external onlyOwner(_registryId) {
        require(_newRegistryOwner != address(0), "AR: new registry owner is 0");
        registryOwners[_registryId] = _newRegistryOwner;
        emit OwnerChanged(_registryId, _newRegistryOwner);
    }

    function requestTimelockChange(uint64 _newSecurityPeriod) external onlyOwner(0) {
        newSecurityPeriod = _newSecurityPeriod;
        securityPeriodChangeAfter = uint64(block.timestamp) + securityPeriod;
        emit TimelockChangeRequested(_newSecurityPeriod);
    }

    function confirmTimelockChange() external {
        uint64 newPeriod = newSecurityPeriod;
        require(securityPeriodChangeAfter > 0 && securityPeriodChangeAfter <= block.timestamp, "AR: can't (yet) change timelock");
        securityPeriod = newPeriod;
        newSecurityPeriod = 0;
        securityPeriodChangeAfter = 0;
        emit TimelockChanged(newPeriod);
    }

    /**************  Management of registries' content  *****************/

    /**
    * @notice Set an authorisation filter for a dapp that has _not_ previously been authorised or 
    * that has previously been authorised _without_ a filter. To change a non-zero filter, use `requestFilterUpdate`
    * and `confirmFilterUpdate` instead.
    * @param _registryId The id of the registry to modify
    * @param _dapp The address of the dapp contract to authorise.
    * @param _filter The address of the filter contract to use.
    */
    function addFilter(uint8 _registryId, address _dapp, address _filter) external onlyOwner(_registryId) {
        uint auth = uint(authorisations[_registryId][_dapp]); // {filter:160}{validFrom:64}
        require((auth >> 64) == 0, "DR: filter already set");
        uint validFrom = auth & 0xffffffffffffffff;
        if(validFrom == 0)  { // this is a newly authorised dapp
            validFrom = block.timestamp + securityPeriod;
            emit DappAdded(_registryId, _dapp, _filter, validFrom);
        } else {
            emit FilterUpdated(_registryId, _dapp, _filter, validFrom);
        }
        // Store the new authorisation as {filter:160}{validFrom:64}.
        // For dapps that have previously been authorised _without_ a filter, we can update the filter immediately (i.e. keep validFrom unchanged)
        // as the addition of a filter necessarily makes the authorisation _more_ restrictive.
        authorisations[_registryId][_dapp] = bytes32((uint(uint160(_filter)) << 64) | validFrom);
    }

    /**
    * @notice Request to change an authorisation filter for a dapp that has previously been authorised _with_ a filter. 
    * For such dapps, we cannot immediately override the existing filter and need to store the new filter for a security
    * period before being able to change the filter. To set a filter for a new dapp or for a dapp that currently has no 
    * filter set, use `addFilter` instead.
    * @param _registryId The id of the registry to modify
    * @param _dapp The address of the dapp contract to authorise.
    * @param _filter The address of the new filter contract to use.
    */
    function requestFilterUpdate(uint8 _registryId, address _dapp, address _filter) external onlyOwner(_registryId) {
        uint auth = uint(authorisations[_registryId][_dapp]); // {filter:160}{validFrom:64}
        require((auth >> 64) > 0, "AR: should use addFilter()");
        uint validFrom = block.timestamp + securityPeriod;
        // Store the future authorisation as {filter:160}{validFrom:64}
        pendingFilterUpdates[_registryId][_dapp] = bytes32((uint(uint160(_filter)) << 64) | validFrom);
        emit FilterUpdateRequested(_registryId, _dapp, _filter, validFrom);
    }

    /**
    * @notice Confirm the filter change requested by `requestFilterUpdate`
    * @param _registryId The id of the registry to modify
    * @param _dapp The address of the dapp contract to authorise.
    */
    function confirmFilterUpdate(uint8 _registryId, address _dapp) external {
        uint newAuth = uint(pendingFilterUpdates[_registryId][_dapp]);
        require(newAuth > 0, "AR: no pending filter update");
        uint validFrom = newAuth & 0xffffffffffffffff;
        require(validFrom <= block.timestamp, "AR: too early to confirm auth");
        pendingFilterUpdates[_registryId][_dapp] = bytes32(newAuth);
        emit FilterUpdated(_registryId, _dapp, address(uint160(newAuth >> 64)), validFrom); 
        delete pendingFilterUpdates[_registryId][_dapp];
    }

    /**
    * @notice Deauthorise a dapp in a registry
    * @param _registryId The id of the registry to modify
    * @param _dapp The address of the dapp contract to deauthorise.
    */
    function removeDapp(uint8 _registryId, address _dapp) external onlyOwner(_registryId) {
        require(authorisations[_registryId][_dapp] != bytes32(0), "AR: unknown dapp");
        delete authorisations[_registryId][_dapp];
        emit DappRemoved(_registryId, _dapp);
    }

    /********  Internal Functions ***********/

    function validateOwner(uint8 _registryId) internal view {
        address owner = registryOwners[_registryId];
        require(owner != address(0), "AR: unknown registry");
        require(msg.sender == owner, "AR: sender != registry owner");
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