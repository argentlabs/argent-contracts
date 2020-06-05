// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "../contracts/modules/common/OnlyOwnerModule.sol";
import "./TestDapp.sol";
import "./LegacyBaseWallet.sol";

/**
 * @title OldTestModule
 * @dev Test Module
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract OldTestModule is OnlyOwnerModule {

    bytes32 constant NAME = "OldTestModule";

    TestDapp public dapp;

    // *************** Constructor ********************** //

    constructor(
        IModuleRegistry _registry
    )
        BaseModule(_registry, IGuardianStorage(0), NAME)
        public
    {
        dapp = new TestDapp();
    }

    // *************** External/Public Functions ********************* //

    function callDapp(LegacyBaseWallet _wallet)
        external
    {
        _wallet.invoke(address(dapp), 0, abi.encodeWithSignature("noReturn()", 0));
    }

    function callDapp2(LegacyBaseWallet _wallet)
        external
    {
        _wallet.invoke(address(dapp), 0, abi.encodeWithSignature("uintReturn(uint256)", 2));
    }

}