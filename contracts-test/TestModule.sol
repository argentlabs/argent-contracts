// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.10;
import "../contracts/modules/common/BaseModule.sol";
import "./TestDapp.sol";

/**
 * @title TestModule
 * @dev Basic test module
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract TestModule is BaseModule {

    bytes32 constant NAME = "TestModule";

    bool boolVal;
    uint uintVal;

    constructor(IModuleRegistry _registry, IGuardianStorage _guardianStorage, bool _boolVal, uint _uintVal) BaseModule(_registry, _guardianStorage, NAME) public {
        boolVal = _boolVal;
        uintVal = _uintVal;
        dapp = new TestDapp();
    }

    function invalidOwnerChange(address _wallet) external {
        IWallet(_wallet).setOwner(address(0)); // this should fail
    }

    function setIntOwnerOnly(address _wallet, uint _val) external onlyOwnerOrModule(_wallet) {
        uintVal = _val;
    }
    function clearInt() external {
        uintVal = 0;
    }

    // used to simulate a bad module in MakerV2Loan tests
    function isNewVersion(address _addr) external view returns (bytes32) {
        return bytes4(keccak256("isNewVersion(address)"));
    }

    function callContract(address _contract, uint256 _value, bytes calldata _data) external {
        // solium-disable-next-line security/no-call-value
        (bool success,) = _contract.call{value: _value}(_data);
        if (!success) {
            // solium-disable-next-line security/no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
    /////////////////

    function init(address _wallet) public override onlyWallet(_wallet) {
        enableStaticCalls(_wallet, address(this));
    }

    function enableStaticCalls(address _wallet, address _module) public {
        IWallet(_wallet).enableStaticCall(_module, bytes4(keccak256("getBoolean()")));
        IWallet(_wallet).enableStaticCall(_module, bytes4(keccak256("getUint()")));
        IWallet(_wallet).enableStaticCall(_module, bytes4(keccak256("getAddress(address)")));
    }

    function getBoolean() public view returns (bool) {
        return boolVal;
    }

    function getUint() public view returns (uint) {
        return uintVal;
    }

    function getAddress(address _addr) public pure returns (address) {
        return _addr;
    }

    function callDapp(address _wallet)
        external
    {
        invokeWallet(_wallet, address(dapp), 0, abi.encodeWithSignature("noReturn()"));
    }

    function callDapp2(address _wallet, uint256 _val, bool _isNewWallet)
        external returns (uint256 _ret)
    {
        bytes memory result = invokeWallet(_wallet, address(dapp), 0, abi.encodeWithSignature("uintReturn(uint256)", _val));
        if (_isNewWallet) {
            require(result.length > 0, "TestModule: callDapp2 returned no result");
            (_ret) = abi.decode(result, (uint256));
            require(_ret == _val, "TestModule: invalid val");
        } else {
            require(result.length == 0, "TestModule: callDapp2 returned some result");
        }
    }

    function fail(address _wallet, string calldata reason) external {
        invokeWallet(_wallet, address(dapp), 0, abi.encodeWithSignature("doFail(string)", reason));
    }

    function getRequiredSignatures(address _wallet, bytes calldata _data) external view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}