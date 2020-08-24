// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
import "../contracts/modules/common/BaseModule.sol";

contract BadModule is BaseModule {

    bytes32 constant NAME = "BadModule";

    constructor(IModuleRegistry _registry)
    BaseModule(_registry, NAME) public
    {
    }

    uint uintVal;
    function setIntOwnerOnly(address _wallet, uint _val) external {
        uintVal = _val;
    }

}