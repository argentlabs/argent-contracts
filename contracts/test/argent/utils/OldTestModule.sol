pragma solidity ^0.5.4;

import "../../../modules/common/BaseModule.sol";
import "../../../modules/common/RelayerModule.sol";
import "../../../modules/common/OnlyOwnerModule.sol";
import "./TestDapp.sol";
import "../legacy/LegacyBaseWallet.sol";

/**
 * @title OldTestModule
 * @dev Test Module
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract OldTestModule is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "OldTestModule";

    TestDapp public dapp;

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry
    )
        BaseModule(_registry, GuardianStorage(0), NAME)
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