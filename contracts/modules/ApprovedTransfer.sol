pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "../storage/GuardianStorage.sol";
import "../utils/SafeMath.sol";
import "../utils/GuardianUtils.sol";

/**
 * @title ApprovedTransfer
 * @dev Module to transfer tokens (ETH or ERC20) with the approval of guardians.
 * @author Julien Niset - <julien@argent.im>
 */
contract ApprovedTransfer is BaseModule, RelayerModule {

    bytes32 constant NAME = "ApprovedTransfer";

    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The Guardian storage 
    GuardianStorage internal guardianStorage;
    event Address(address _addr);
    event Transfer(address indexed wallet, address indexed token, uint256 indexed amount, address to, bytes data);    

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "AT: wallet must be unlocked");
        _;
    }

    constructor(ModuleRegistry _registry, GuardianStorage _guardianStorage) BaseModule(_registry, NAME) public {
        guardianStorage = _guardianStorage;
    }

    /**
    * @dev transfers tokens (ETH or ERC20) from a wallet.
    * @param _wallet The target wallet.
    * @param _token The address of the token to transfer.
    * @param _to The destination address
    * @param _amount The amoutnof token to transfer
    * @param _data  The data for the transaction (only for ETH transfers)
    */
    function transferToken(
        BaseWallet _wallet,
        address _token,
        address _to,
        uint256 _amount,
        bytes calldata _data
    )
        external
        onlyExecute
        onlyWhenUnlocked(_wallet)
    {
        // eth transfer to whitelist
        if(_token == ETH_TOKEN) {
            _wallet.invoke(_to, _amount, _data);
            emit Transfer(address(_wallet), ETH_TOKEN, _amount, _to, _data);
        }
        // erc20 transfer to whitelist
        else {
            bytes memory methodData = abi.encodeWithSignature("transfer(address,uint256)", _to, _amount);
            _wallet.invoke(_token, 0, methodData);
            emit Transfer(address(_wallet), _token, _amount, _to, _data);
        }
    }

    // *************** Implementation of RelayerModule methods ********************* //

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
        address lastSigner = address(0);
        address[] memory guardians = guardianStorage.getGuardians(_wallet);
        bool isGuardian = false;
        for (uint8 i = 0; i < _signatures.length / 65; i++) {
            address signer = recoverSigner(_signHash, _signatures, i);
            if(i == 0) {
                // AT: first signer must be owner
                if(!isOwner(_wallet, signer)) {
                    return false;
                }
            }
            else {
                // "AT: signers must be different"
                if(signer <= lastSigner) {
                    return false;
                }
                lastSigner = signer;
                (isGuardian, guardians) = GuardianUtils.isGuardian(guardians, signer);
                // "AT: signatures not valid"
                if(!isGuardian) {
                    return false;
                }
            }
        }
        return true;
    }

    function getRequiredSignatures(BaseWallet _wallet, bytes memory /* _data */) internal view returns (uint256) {
        // owner  + [n/2] guardians
        return  1 + SafeMath.ceil(guardianStorage.guardianCount(_wallet), 2);
    }
}