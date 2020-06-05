// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;
import "../contracts/wallet/BaseWallet.sol";
import "../contracts/modules/common/OnlyOwnerModule.sol";

/**
 * @title TestOnlyOwnerModule
 * @dev Basic test onlyowner module.
 * @author Julien Niset - <julien@argent.im>
 */
contract TestOnlyOwnerModule is OnlyOwnerModule {

    bytes32 constant NAME = "TestOnlyOwnerModule";
    constructor(IModuleRegistry _registry) BaseModule(_registry, IGuardianStorage(0), NAME) public {}
}