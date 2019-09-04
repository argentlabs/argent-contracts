pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "../modules/common/BaseModule.sol";

/**
 * @title BaseModule
 * @dev Basic module that contains some methods common to all modules.
 * @author Julien Niset - <julien@argent.im>
 */
contract TestModule is BaseModule {

    bytes32 constant NAME = "TestModule";

    bool boolVal;
    uint uintVal;

    constructor(ModuleRegistry _registry, bool _boolVal, uint _uintVal) BaseModule(_registry, NAME) public {
        boolVal = _boolVal;
        uintVal = _uintVal;
    }

    function init(BaseWallet _wallet) public onlyWallet(_wallet) {
        _wallet.enableStaticCall(address(this), bytes4(keccak256("getBoolean()")));
        _wallet.enableStaticCall(address(this), bytes4(keccak256("getUint()")));
        _wallet.enableStaticCall(address(this), bytes4(keccak256("getAddress(address)")));
    }

    function getBoolean() public view returns (bool) {
        return boolVal;
    }

    function getUint() public view returns (uint) {
        return uintVal;
    }

    function getAddress(address _addr) public view returns (address) {
        return _addr;
    }

}