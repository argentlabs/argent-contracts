pragma solidity ^0.5.4;
import "../../../wallet/BaseWallet.sol";
import "../../../modules/common/BaseModule.sol";
import "../../../modules/common/RelayerModule.sol";
import "../../../modules/common/LimitManager.sol";
import "../../../exchange/TokenPriceProvider.sol";
import "../../../storage/GuardianStorage.sol";
import "../../../storage/TransferStorage.sol";

/**
 * @title LegacyTokenTransfer
 * @dev Legacy Module to transfer tokens (ETH or ERC20) based on a security context (daily limit, whitelist, etc).
 * @author Julien Niset - <julien@argent.im>
 */
contract LegacyTokenTransfer is BaseModule, RelayerModule, LimitManager {

    bytes32 constant NAME = "TokenTransfer";

    bytes4 constant internal EXECUTE_PENDING_PREFIX = bytes4(keccak256("executePendingTransfer(address,address,address,uint256,bytes,uint256)"));

    bytes constant internal EMPTY_BYTES = "";

    using SafeMath for uint256;

    // Mock token address for ETH
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // large limit when the limit can be considered disabled
    uint128 constant internal LIMIT_DISABLED = uint128(-1); // 3.40282366920938463463374607431768211455e+38

    struct TokenTransferConfig {
        // Mapping between pending transfer hash and their timestamp
        mapping (bytes32 => uint256) pendingTransfers;
    }

    // wallet specific storage
    mapping (address => TokenTransferConfig) internal configs;

    // The security period
    uint256 public securityPeriod;
    // The execution window
    uint256 public securityWindow;
    // The Token storage
    TransferStorage public transferStorage;
    // The Token price provider
    TokenPriceProvider public priceProvider;

    // *************** Events *************************** //

    event Transfer(address indexed wallet, address indexed token, uint256 indexed amount, address to, bytes data);
    event AddedToWhitelist(address indexed wallet, address indexed target, uint64 whitelistAfter);
    event RemovedFromWhitelist(address indexed wallet, address indexed target);
    event PendingTransferCreated(address indexed wallet, bytes32 indexed id, uint256 indexed executeAfter, address token, address to, uint256 amount, bytes data);
    event PendingTransferExecuted(address indexed wallet, bytes32 indexed id);
    event PendingTransferCanceled(address indexed wallet, bytes32 indexed id);

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        TransferStorage _transferStorage,
        GuardianStorage _guardianStorage,
        address _priceProvider,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint256 _defaultLimit
    )
        BaseModule(_registry, _guardianStorage, NAME)
        LimitManager(_defaultLimit)
        public
    {
        transferStorage = _transferStorage;
        priceProvider = TokenPriceProvider(_priceProvider);
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
    }

    // *************** External/Public Functions ********************* //

    /**
    * @dev lets the owner transfer tokens (ETH or ERC20) from a wallet.
    * @param _wallet The target wallet.
    * @param _token The address of the token to transfer.
    * @param _to The destination address
    * @param _amount The amoutn of token to transfer
    * @param _data The data for the transaction
    */
    function transferToken(
        BaseWallet _wallet,
        address _token,
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) 
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        if(isWhitelisted(_wallet, _to)) {
            // eth transfer to whitelist
            if(_token == ETH_TOKEN) {
                transferETH(_wallet, _to, _amount, _data);
            }
            // erc20 transfer to whitelist
            else {
                transferERC20(_wallet, _token, _to, _amount, _data);
            }
        }
        else {
            if(_token == ETH_TOKEN) {
                // eth transfer under the limit
                if (checkAndUpdateDailySpent(_wallet, _amount)) {
                    transferETH(_wallet, _to, _amount, _data);
                }
                // eth transfer above the limit
                else {
                    addPendingTransfer(_wallet, ETH_TOKEN, _to, _amount, _data);
                }
            }
            else {
                uint256 etherAmount = priceProvider.getEtherValue(_amount, _token);
                // erc20 transfer under the limit
                if (checkAndUpdateDailySpent(_wallet, etherAmount)) {
                    transferERC20(_wallet, _token, _to, _amount, _data);
                }
                // erc20 transfer above the limit
                else {
                    addPendingTransfer(_wallet, _token, _to, _amount, _data); 
                }
            }
        }
    }

    /**
     * @dev Adds an address to the whitelist of a wallet. 
     * @param _wallet The target wallet.
     * @param _target The address to add.
     */
    function addToWhitelist(
        BaseWallet _wallet,
        address _target
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(!isWhitelisted(_wallet, _target), "TT: target already whitelisted");
        // solium-disable-next-line security/no-block-members
        uint256 whitelistAfter = now.add(securityPeriod);
        transferStorage.setWhitelist(_wallet, _target, whitelistAfter);
        emit AddedToWhitelist(address(_wallet), _target, uint64(whitelistAfter));
    }

    /**
     * @dev Removes an address from the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The address to remove.
     */
    function removeFromWhitelist(
        BaseWallet _wallet,
        address _target
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(isWhitelisted(_wallet, _target), "TT: target not whitelisted");
        transferStorage.setWhitelist(_wallet, _target, 0);
        emit RemovedFromWhitelist(address(_wallet), _target);
    }

    /**
    * @dev Executes a pending transfer for a wallet.
    * The destination address is automatically added to the whitelist.
    * The method can be called by anyone to enable orchestration.
    * @param _wallet The target wallet.
    * @param _token The token of the pending transfer.
    * @param _to The destination address of the pending transfer.
    * @param _amount The amount of token to transfer of the pending transfer.
    * @param _block The block at which the pending transfer was created.
    */
    function executePendingTransfer(
        BaseWallet _wallet,
        address _token,
        address _to,
        uint _amount,
        bytes memory _data,
        uint _block
    )
        public
        onlyWhenUnlocked(_wallet)
    {
        bytes32 id = keccak256(abi.encodePacked(_token, _to, _amount, _data, _block));
        uint executeAfter = configs[address(_wallet)].pendingTransfers[id];
        uint executeBefore = executeAfter.add(securityWindow);
        require(executeAfter <= now && now <= executeBefore, "TT: outside of the execution window");
        removePendingTransfer(_wallet, id);
        if(_token == ETH_TOKEN) {
            transferETH(_wallet, _to, _amount, _data);
        }
        else {
            transferERC20(_wallet, _token, _to, _amount, _data);
        }
        emit PendingTransferExecuted(address(_wallet), id);
    }

    /**
    * @dev Cancels a pending transfer for a wallet.
    * @param _wallet The target wallet.
    * @param _id the pending transfer Id.
    */
    function cancelPendingTransfer(
        BaseWallet _wallet,
        bytes32 _id
    )
        public
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(configs[address(_wallet)].pendingTransfers[_id] > 0, "TT: unknown pending transfer");
        removePendingTransfer(_wallet, _id);
        emit PendingTransferCanceled(address(_wallet), _id);
    }

    /**
     * @dev Lets the owner of a wallet change its global limit.
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
    * @dev Checks if an address is whitelisted for a wallet.
    * @param _wallet The target wallet.
    * @param _target The address.
    * @return true if the address is whitelisted.
    */
    function isWhitelisted(BaseWallet _wallet, address _target) public view returns (bool _isWhitelisted) {
        uint whitelistAfter = transferStorage.getWhitelist(_wallet, _target);
        // solium-disable-next-line security/no-block-members
        return whitelistAfter > 0 && whitelistAfter < now;
    }

    /**
    * @dev Gets the info of a pending transfer for a wallet.
    * @param _wallet The target wallet.
    * @param _id The pending transfer Id.
    * @return the epoch time at which the pending transfer can be executed.
    */
    function getPendingTransfer(BaseWallet _wallet, bytes32 _id) external view returns (uint64 _executeAfter) {
        _executeAfter = uint64(configs[address(_wallet)].pendingTransfers[_id]);
    }

    // *************** Internal Functions ********************* //

    /**
    * @dev Helper method to transfer ETH for a wallet.
    * @param _wallet The target wallet.
    * @param _to The recipient.
    * @param _value The amount of ETH to transfer
    * @param _data The data to *log* with the transfer.
    */
    function transferETH(BaseWallet _wallet, address _to, uint256 _value, bytes memory _data) internal {
        _wallet.invoke(_to, _value, EMPTY_BYTES);
        emit Transfer(address(_wallet), ETH_TOKEN, _value, _to, _data);
    }

    /**
    * @dev Helper method to transfer ERC20 for a wallet.
    * @param _wallet The target wallet.
    * @param _token The ERC20 address.
    * @param _to The recipient.
    * @param _value The amount of token to transfer
    * @param _data The data to pass with the trnasfer.
    */
    function transferERC20(BaseWallet _wallet, address _token, address _to, uint256 _value, bytes memory _data) internal {
        bytes memory methodData = abi.encodeWithSignature("transfer(address,uint256)", _to, _value);
        _wallet.invoke(_token, 0, methodData);
        emit Transfer(address(_wallet), _token, _value, _to, _data);
    }

    /**
     * @dev Creates a new pending transfer for a wallet.
     * @param _wallet The target wallet.
     * @param _token The token for the transfer.
     * @param _to The recipient for the transfer.
     * @param _amount The amount of token to transfer.
     * @param _data The data associated to the transfer.
     * @return the identifier for the new pending transfer.
     */
    function addPendingTransfer(BaseWallet _wallet, address _token, address _to, uint _amount, bytes memory _data) internal returns (bytes32) {
        bytes32 id = keccak256(abi.encodePacked(_token, _to, _amount, _data, block.number));
        uint executeAfter = now.add(securityPeriod);
        configs[address(_wallet)].pendingTransfers[id] = executeAfter;
        emit PendingTransferCreated(address(_wallet), id, executeAfter, _token, _to, _amount, _data);
    }

    /**
    * @dev Removes an existing pending transfer.
    * @param _wallet The target wallet
    * @param _id The id of the transfer to remove.
    */
    function removePendingTransfer(BaseWallet _wallet, bytes32 _id) internal {
        delete configs[address(_wallet)].pendingTransfers[_id];
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
            || _wallet.authorised(address(_wallet)) == false
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
        bytes memory /* _data */,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        address signer = recoverSigner(_signHash, _signatures, 0);
        return isOwner(_wallet, signer); // "TT: signer must be owner"
    }

    function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory _data) internal view returns (uint256) {
        bytes4 methodId = functionPrefix(_data);
        if (methodId == EXECUTE_PENDING_PREFIX) {
            return 0;
        }
        return 1;
    }
}