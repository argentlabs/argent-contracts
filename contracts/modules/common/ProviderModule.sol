pragma solidity ^0.5.4;
import "../../base/Owned.sol";

/**
 * @title ProviderModule
 * @dev Module that can delegate the execution of a call to a set of providers satisfying a common interface.
 * Only the owner of the Module can register providers. 
 * @author Julien Niset - <julien@argent.im>
 */
contract ProviderModule is Owned {

    // Supported providers
    mapping (bytes32 => Provider) public providers; 

    struct Provider {
        address addr;
        address[] oracles;
    }

    function addProvider(bytes32 _key, address _addr, address[] memory _oracles) public onlyOwner {
        providers[_key] = Provider(_addr, _oracles);
    } 

    function getProvider(bytes32 _key) public view returns (address _addr) {
        _addr = providers[_key].addr;
    }

    function delegateToProvider(address _provider, bytes memory _methodData) internal returns (bool, bytes memory) {
        require(_provider != address(0), "ProviderModule: Unknown provider");
        return _provider.delegatecall(_methodData);
    }
}