pragma solidity ^0.5.4;
import "../../../wallet/BaseWallet.sol";
import "../../../modules/common/BaseModule.sol";
import "../../../modules/common/RelayerModule.sol";

/**
 * @title TestModule
 * @dev Basic test module.
 * @author Julien Niset - <julien@argent.im>
 */
contract TestModule is BaseModule, RelayerModule {

    bytes32 constant NAME = "TestModule";

    bool boolVal;
    uint uintVal;

    constructor(ModuleRegistry _registry, bool _boolVal, uint _uintVal) BaseModule(_registry, GuardianStorage(0), NAME) public {
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

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory /* _data */,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        address signer = recoverSigner(_signHash, _signatures, 0);
        return isOwner(_wallet, signer); // "GM: signer must be owner"
    }

    function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory /*_data */) internal view returns (uint256) {
        return 1;
    }

}