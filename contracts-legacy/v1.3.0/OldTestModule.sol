pragma solidity ^0.5.4;

import "./OnlyOwnerModule.sol";
import "../../contracts-test/TestDapp.sol";
import "./BaseWallet.sol";

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
        ModuleRegistry _registry
    )
        BaseModule(_registry, GuardianStorage(0), NAME)
        public
    {
        dapp = new TestDapp();
    }

    // *************** External/Public Functions ********************* //

    function callDapp(BaseWallet _wallet)
        external
    {
        _wallet.invoke(address(dapp), 0, abi.encodeWithSignature("noReturn()", 0));
    }

    function callDapp2(BaseWallet _wallet)
        external
    {
        _wallet.invoke(address(dapp), 0, abi.encodeWithSignature("uintReturn(uint256)", 2));
    }

}