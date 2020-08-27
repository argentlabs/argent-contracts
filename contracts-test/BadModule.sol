// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
import "../contracts/modules/common/IModule.sol";

contract BadModule is IModule {

    function init(address _wallet) external override {}

    uint uintVal;
    function setIntOwnerOnly(address _wallet, uint _val) external {
        uintVal = _val;
    }

}