pragma solidity ^0.5.4;
import "../../../wallet/BaseWallet.sol";
import "../../../modules/common/OnlyOwnerModule.sol";

/**
 * @title TestModule
 * @dev Basic test module.
 * @author Julien Niset - <julien@argent.im>
 */
contract TestOnlyOwnerModule is OnlyOwnerModule {

    bytes32 constant NAME = "TestOnlyOwnerModule";
    constructor(ModuleRegistry _registry) BaseModule(_registry, GuardianStorage(0), NAME) public {}
}