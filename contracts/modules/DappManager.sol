pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/LimitManager.sol";
import "./TokenTransfer.sol";
import "../storage/GuardianStorage.sol";
import "../storage/DappStorage.sol";
import "../dapp/DappRegistry.sol";

/**
 * @title DappManager
 * @dev Module to enable authorised dapps to transfer tokens (ETH or ERC20) on behalf of a wallet.
 * @author Olivier Van Den Biggelaar - <olivier@argent.im>
 */
contract DappManager is BaseModule, RelayerModule, LimitManager {

    bytes32 constant NAME = "DappManager";

    bytes4 constant internal CONFIRM_AUTHORISATION_PREFIX = bytes4(keccak256("confirmAuthorizeCall(address,address,address,bytes4[])"));
    bytes4 constant internal CALL_CONTRACT_PREFIX = bytes4(keccak256("callContract(address,address,address,uint256,bytes)"));

    // Mock token address for ETH
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    // // The Guardian storage 
    GuardianStorage public guardianStorage;
    // The Dapp limit storage
    DappStorage public dappStorage;
    // The authorised dapp registry
    DappRegistry public dappRegistry;
    // The security period
    uint256 public securityPeriod;
    // the security window
    uint256 public securityWindow;

    struct DappManagerConfig {
        // the time at which a dapp authorisation can be confirmed
        mapping (bytes32 => uint256) pending;
    }

    // the wallet specific storage
    mapping (address => DappManagerConfig) internal configs;

    // *************** Events *************************** //
  
    event Transfer(address indexed wallet, address indexed token, uint256 indexed amount, address to, bytes data);    
    event ContractCallAuthorizationRequested(address indexed _wallet, address indexed _dapp, address indexed _contract, bytes4[] _signatures);
    event ContractCallAuthorizationCanceled(address indexed _wallet, address indexed _dapp, address indexed _contract, bytes4[] _signatures);
    event ContractCallAuthorized(address indexed _wallet, address indexed _dapp, address indexed _contract, bytes4[] _signatures);
    event ContractCallDeauthorized(address indexed _wallet, address indexed _dapp, address indexed _contract, bytes4[] _signatures);

    // *************** Modifiers *************************** //

    /**
     * @dev Throws unless called by this contract or by _dapp.
     */
    modifier onlyExecuteOrDapp(address _dapp) {
        require(msg.sender == address(this) || msg.sender == _dapp, "DM: must be called by dapp or via execute()");
        _;
    }

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "DM: wallet must be unlocked");
        _;
    }

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        DappRegistry _dappRegistry,
        DappStorage _dappStorage,
        GuardianStorage _guardianStorage,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint256 _defaultLimit
    )
        BaseModule(_registry, NAME)
        LimitManager(_defaultLimit)
        public
    {
        dappStorage = _dappStorage;
        guardianStorage = _guardianStorage;
        dappRegistry = _dappRegistry;
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
    }

    // *************** External/Public Functions ********************* //

    /**
    * @dev lets a dapp call an arbitrary contract from a wallet.
    * @param _wallet The target wallet.
    * @param _dapp The authorised dapp.
    * @param _to The destination address
    * @param _amount The amoun6 of ether to transfer
    * @param _data The data for the transaction
    */
    function callContract(
        BaseWallet _wallet,
        address _dapp,
        address _to,
        uint256 _amount,
        bytes calldata _data
    )
        external
        onlyExecuteOrDapp(_dapp)
        onlyWhenUnlocked(_wallet)
    {
        require(isAuthorizedCall(_wallet, _dapp, _to, _data), "DM: Contract call not authorized");
        require(checkAndUpdateDailySpent(_wallet, _amount), "DM: Dapp limit exceeded");
        doCall(_wallet, _to, _amount, _data);
    }

    /**
     * @dev Authorizes an external contract's methods to be called by a dapp key of the wallet.
     * @param _wallet The wallet.
     * @param _dapp The address of the signing key.
     * @param _contract The target contract address.
     * @param _signatures The method signatures.
     */
    function authorizeCall(
        BaseWallet _wallet,
        address _dapp,
        address _contract,
        bytes4[] calldata _signatures
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(_contract != address(0), "DM: Contract address cannot be null");
        if(dappRegistry.isRegistered(_contract, _signatures)) {
            // authorise immediately
            dappStorage.setMethodAuthorization(_wallet, _dapp, _contract, _signatures, true);
            emit ContractCallAuthorized(address(_wallet), _dapp, _contract, _signatures);
        }
        else {
            bytes32 id = keccak256(abi.encodePacked(address(_wallet), _dapp, _contract, _signatures, true));
            configs[address(_wallet)].pending[id] = now + securityPeriod;
            emit ContractCallAuthorizationRequested(address(_wallet), _dapp, _contract, _signatures);
        }
    }

    /**
     * @dev Deauthorizes an external contract's methods to be called by a dapp key of the wallet.
     * @param _wallet The wallet.
     * @param _dapp The address of the signing key.
     * @param _contract The target contract address.
     * @param _signatures The method signatures.
     */
    function deauthorizeCall(
        BaseWallet _wallet,
        address _dapp,
        address _contract,
        bytes4[] calldata _signatures
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        dappStorage.setMethodAuthorization(_wallet, _dapp, _contract, _signatures, false);
        emit ContractCallDeauthorized(address(_wallet), _dapp, _contract, _signatures);
    }

    /**
     * @dev Confirms the authorisation of an external contract's methods to be called by a dapp key of the wallet.
     * @param _wallet The wallet.
     * @param _dapp The address of the signing key.
     * @param _contract The target contract address.
     * @param _signatures The method signatures.
     */
    function confirmAuthorizeCall(
        BaseWallet _wallet,
        address _dapp,
        address _contract,
        bytes4[] calldata _signatures
    )
        external
        onlyWhenUnlocked(_wallet)
    {
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _dapp, _contract, _signatures, true));
        DappManagerConfig storage config = configs[address(_wallet)];
        require(config.pending[id] > 0, "DM: No pending authorisation for the target dapp");
        require(config.pending[id] < now, "DM: Too early to confirm pending authorisation");
        require(now < config.pending[id] + securityWindow, "GM: Too late to confirm pending authorisation");
        dappStorage.setMethodAuthorization(_wallet, _dapp, _contract, _signatures, true);
        delete config.pending[id];
        emit ContractCallAuthorized(address(_wallet), _dapp, _contract, _signatures);
    }

    /**
     * @dev Cancels an authorisation request for an external contract's methods to be called by a dapp key of the wallet.
     * @param _wallet The wallet.
     * @param _dapp The address of the signing key.
     * @param _contract The target contract address.
     * @param _signatures The method signatures.
     */
    function cancelAuthorizeCall(
        BaseWallet _wallet,
        address _dapp,
        address _contract,
        bytes4[] memory _signatures
    )
        public
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _dapp, _contract, _signatures, true));
        DappManagerConfig storage config = configs[address(_wallet)];
        require(config.pending[id] > 0, "DM: No pending authorisation for the target dapp");
        delete config.pending[id];
        emit ContractCallAuthorizationCanceled(address(_wallet), _dapp, _contract, _signatures);
    }

    /**
    * @dev Checks if a contract call is authorized for a given signing key.
    * @param _wallet The target wallet.
    * @param _dapp The address of the signing key.
    * @param _to The address of the contract to call
    * @param _data The call data
    * @return true if the contract call is authorised for the wallet.
    */
    function isAuthorizedCall(BaseWallet _wallet, address _dapp, address _to, bytes memory _data) public view returns (bool _isAuthorized) {
        if(_data.length >= 4) {
            return dappStorage.getMethodAuthorization(_wallet, _dapp, _to, functionPrefix(_data));
        }
        // the fallback method must be authorized
        return dappStorage.getMethodAuthorization(_wallet, _dapp, _to, "");
    }

    /**
     * @dev Lets the owner of a wallet change its dapp limit.
     * The limit is expressed in ETH. Changes to the limit take 24 hours.
     * @param _wallet The target wallet.
     * @param _newLimit The new limit.
     */
    function changeLimit(BaseWallet _wallet, uint256 _newLimit) public onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        changeLimit(_wallet, _newLimit, securityPeriod);
    }

    /**
     * @dev Convenience method to disable the limit
     * The limit is disabled by setting it to an arbitrary large value.
     * @param _wallet The target wallet.
     */
    function disableLimit(BaseWallet _wallet) external onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        changeLimit(_wallet, LIMIT_DISABLED, securityPeriod);
    }

    /**
    * @dev Internal method to instruct a wallet to call an extrenal contract.
    * @param _wallet The target wallet.
    * @param _to The external contract.
    * @param _value The amount of ETH for the call
    * @param _data The data of the call.
    */

    function doCall(BaseWallet _wallet, address _to, uint256 _value, bytes memory _data) internal {
        _wallet.invoke(_to, _value, _data);
        emit Transfer(address(_wallet), ETH_TOKEN, _value, _to, _data);
    }

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides refund to add the refund in the daily limit.
    function refund(BaseWallet _wallet, uint _gasUsed, uint _gasPrice, uint _gasLimit, uint _signatures, address _relayer) internal {
        // 21000 (transaction) + 7620 (execution of refund) + 7324 (execution of updateDailySpent) + 672 to log the event + _gasUsed
        uint256 amount = 36616 + _gasUsed;
        if(_gasPrice > 0 && _signatures > 0 && amount <= _gasLimit) {
            if(_gasPrice > tx.gasprice) {
                amount = amount * tx.gasprice;
            }
            else {
                amount = amount * _gasPrice;
            }
            updateDailySpent(_wallet, uint128(getCurrentLimit(_wallet)), amount);
            _wallet.invoke(_relayer, amount, "");
        }
    }

    // Overrides verifyRefund to add the refund in the daily limit.
    function verifyRefund(BaseWallet _wallet, uint _gasUsed, uint _gasPrice, uint _signatures) internal view returns (bool) {
        if(_gasPrice > 0 && _signatures > 0 && (
                address(_wallet).balance < _gasUsed * _gasPrice 
                || isWithinDailyLimit(_wallet, getCurrentLimit(_wallet), _gasUsed * _gasPrice) == false
                || _wallet.authorised(address(this)) == false
        ))
        {
            return false;
        }
        return true;
    }

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory _data,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        address signer = recoverSigner(_signHash, _signatures, 0);
        if(functionPrefix(_data) == CALL_CONTRACT_PREFIX) {
            // "RM: Invalid dapp in data"
            if(_data.length < 68) {
                return false;
            }
            address dapp;
            // solium-disable-next-line security/no-inline-assembly
            assembly {
                //_data = {length:32}{sig:4}{_wallet:32}{_dapp:32}{...}
                dapp := mload(add(_data, 0x44))
            }
            return dapp == signer; // "DM: dapp and signer must be the same"
        } else {
            return isOwner(_wallet, signer); // "DM: signer must be owner"
        }
    }

    function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory _data) internal view returns (uint256) {
        bytes4 methodId = functionPrefix(_data);
        if (methodId == CONFIRM_AUTHORISATION_PREFIX) {
            return 0;
        }
        return 1;
    }
}