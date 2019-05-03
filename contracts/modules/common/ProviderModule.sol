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
    mapping (address => Provider) public providers; 

    struct Provider {
        bool exists;
        address[] oracles;
    }

    function addProvider(address _provider, address[] memory _oracles) public onlyOwner {
        providers[_provider] = Provider(true, _oracles);
    } 

    function removeProvider(address _provider) public onlyOwner {
        delete providers[_provider];
    } 

    function isProvider(address _provider) public view returns (bool) {
        return providers[_provider].exists;
    }

    function delegateToProvider(address _provider, bytes memory _methodData) internal returns (bool, bytes memory) {
        require(_provider != address(0), "ProviderModule: Unknown provider");
        return _provider.delegatecall(_methodData);
    }
}