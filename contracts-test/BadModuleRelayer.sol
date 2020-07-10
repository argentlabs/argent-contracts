// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.10;
import "../contracts/modules/common/BaseModule.sol";
import "../contracts/modules/common/RelayerModule.sol";

contract BadModuleRelayer is BaseModule, RelayerModule {

    bytes32 constant NAME = "BadModuleRelayer";

    constructor(IModuleRegistry _registry, IGuardianStorage _guardianStorage)
    BaseModule(_registry, _guardianStorage, NAME) public
    {
    }

    uint uintVal;
    function setIntOwnerOnly(address _wallet, uint _val) external {
        uintVal = _val;
    }

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(address _wallet, uint256 _nonce, bytes32 /* _signHash */) internal override returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function getRequiredSignatures(address /* _wallet */, bytes memory /*_data */) public view override returns (uint256, OwnerSignature) {
        return (0, OwnerSignature.Required);
    }
}