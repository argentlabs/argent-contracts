pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/access/AccessControl.sol";


contract Whitelisted is AccessControl {

    bytes32 public constant WHITELISTED_ROLE = keccak256("WHITELISTED_ROLE");

    constructor() public {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

}
