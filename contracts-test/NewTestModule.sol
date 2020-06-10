// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.9;

import "../contracts/modules/common/OnlyOwnerModule.sol";
import "./TestDapp.sol";

/**
 * @title NewTestModule
 * @dev Test Module
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract NewTestModule is OnlyOwnerModule {

    bytes32 constant NAME = "NewTestModule";

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

    function callDapp(address _wallet)
        external
    {
        invokeWallet(_wallet, address(dapp), 0, abi.encodeWithSignature("noReturn()"));
    }

    function callDapp2(address _wallet, uint256 _val, bool _isNewWallet)
        external returns (uint256 _ret)
    {
        bytes memory result = invokeWallet(_wallet, address(dapp), 0, abi.encodeWithSignature("uintReturn(uint256)", _val));
        if(_isNewWallet) {
            require(result.length > 0, "NewTestModule: callDapp2 returned no result");
            (_ret) = abi.decode(result, (uint256));
            require(_ret == _val, "NewTestModule: invalid val");
        } else {
            require(result.length == 0, "NewTestModule: callDapp2 returned some result");
        }
    }

    function fail(address _wallet, string calldata reason) external {
        invokeWallet(_wallet, address(dapp), 0, abi.encodeWithSignature("doFail(string)", reason));
    }

}