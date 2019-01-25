pragma solidity ^0.4.24;
import "./BaseModule.sol";
import "./RelayerModule.sol";
import "../../wallet/BaseWallet.sol";

/**
 * @title OnlyOwnerModule
 * @dev Module that extends BaseModule and RelayerModule for modules where the execute() method
 * must be called with one signature frm the owner.
 * @author Julien Niset - <julien@argent.im>
 */
contract OnlyOwnerModule is BaseModule, RelayerModule {

    // *************** Implementation of RelayerModule methods ********************* //

    function validateSignatures(BaseWallet _wallet, bytes _data, bytes32 _signHash, bytes _signatures) internal view returns (bool) {
        address signer = recoverSigner(_signHash, _signatures, 0);
        return isOwner(_wallet, signer); // "OOM: signer must be owner"
    }

    function getRequiredSignatures(BaseWallet _wallet, bytes _data) internal view returns (uint256) {
        return 1;
    }
}