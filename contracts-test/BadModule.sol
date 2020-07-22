// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
import "../contracts/modules/common/BaseModule.sol";

contract BadModule is BaseModule {

    bytes32 constant NAME = "BadModule";

    constructor(IModuleRegistry _registry, IGuardianStorage _guardianStorage)
    BaseModule(_registry, _guardianStorage, NAME) public
    {
    }

    uint uintVal;
    function setIntOwnerOnly(address _wallet, uint _val) external {
        uintVal = _val;
    }

    function getRequiredSignatures(address /* _wallet */, bytes memory /*_data */) public view override returns (uint256, OwnerSignature) {
        return (0, OwnerSignature.Required);
    }
}