pragma solidity ^0.6.8;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/**
 * ERC20 test contract.
 */
contract TestERC20 is ERC20 {

    string constant public symbol = "AGT";
    string constant public name = "ArgentToken";
    uint8 public decimals;

    constructor (address[] memory _initialAccounts, uint _supply, uint8 _decimals) public {
        decimals = _decimals;
        for(uint i = 0; i < _initialAccounts.length; i++) {
            _mint(_initialAccounts[i], _supply * 10**uint(_decimals));
        }
    }

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) public {
        _burn(account, amount);
    }

    function burnFrom(address account, uint256 amount) public {
        _burnFrom(account, amount);
    }
}
