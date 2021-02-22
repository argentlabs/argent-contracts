pragma solidity ^0.6.12;

import "./IAuthoriser.sol";
import "./IFilter.sol";
import "../../infrastructure/base/Owned.sol";

contract DappAuthoriser is IAuthoriser, Owned {

    struct Authorisation {
        bool isActive;
        address filter;
    }

    mapping (address => Authorisation) public authorisations;

    function authorise(address _contract, bytes calldata _data) external view override returns (bool) {
        Authorisation memory authorisation = authorisations[_contract];
        if (authorisation.isActive) {
            return _data.length == 0 || authorisation.filter == address(0) || IFilter(authorisation.filter).validate(_data);
        }
    }

    function addAuthorisation(address _contract, address _filter) external onlyOwner {
        authorisations[_contract] = Authorisation(true, _filter);
    }
}