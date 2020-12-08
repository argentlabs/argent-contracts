// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
import "../contracts/infrastructure/storage/ILockStorage.sol";
import "../contracts/modules/common/BaseFeature.sol";
import "./TestDapp.sol";

/**
 * @title TestModule
 * @notice Basic test module
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract TestFeature is BaseFeature {

    bytes32 constant NAME = "TestFeature";

    uint uintVal;
    TestDapp public dapp;
    mapping (address => uint) public numInits;

    constructor(
        ILockStorage _lockStorage,
        IVersionManager _versionManager,
        uint _uintVal
    ) 
        BaseFeature(_lockStorage, _versionManager, NAME) 
        public 
    {
        uintVal = _uintVal;
        dapp = new TestDapp();
    }

    function init(address _wallet) external override  {
        numInits[_wallet] += 1;
    }

    function invalidOwnerChange(address _wallet) external {
        versionManager.setOwner(_wallet, address(0)); // this should fail
    }

    function setIntOwnerOnly(address _wallet, uint _val) external onlyWalletOwnerOrFeature(_wallet) {
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
        (bool success,) = _contract.call{value: _value}(_data);
        if (!success) {
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
    /////////////////

    /**
     * @inheritdoc IFeature
     */
    function getStaticCallSignatures() external virtual override view returns (bytes4[] memory _sigs) {
        _sigs = new bytes4[](4);
        _sigs[0] = bytes4(keccak256("getBoolean()"));
        _sigs[1] = bytes4(keccak256("getUint()"));
        _sigs[2] = bytes4(keccak256("getAddress(address)"));
        _sigs[3] = bytes4(keccak256("badStaticCall()"));
    }

    function getBoolean() public view returns (bool) {
        return true;
    }

    function getUint() public view returns (uint) {
        return 42;
    }

    function getAddress(address _addr) public pure returns (address) {
        return _addr;
    }

    function badStaticCall() external {
        uintVal = 123456;
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

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }

    function invokeStorage(address _wallet, address _storage, bytes calldata _data) external {
        versionManager.invokeStorage(_wallet, _storage, _data);
    }
}