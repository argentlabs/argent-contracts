// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "./common/OnlyOwnerModule.sol";
import "./common/BaseTransfer.sol";
import "./common/LimitManager.sol";
import "../infrastructure/storage/ITransferStorage.sol";
import "./common/TokenPriceProvider.sol";
import "../../lib/other/ERC20.sol";

/**
 * @title TransferManager
 * @dev Module to transfer and approve tokens (ETH or ERC20) or data (contract call) based on a security context (daily limit, whitelist, etc).
 * This module is the V2 of TokenTransfer.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TransferManager is OnlyOwnerModule, BaseTransfer, LimitManager {

    bytes32 constant NAME = "TransferManager";

    bytes4 private constant ERC1271_ISVALIDSIGNATURE_BYTES = bytes4(keccak256("isValidSignature(bytes,bytes)"));
    bytes4 private constant ERC1271_ISVALIDSIGNATURE_BYTES32 = bytes4(keccak256("isValidSignature(bytes32,bytes)"));

    enum ActionType { Transfer }

    using SafeMath for uint256;

    struct TokenManagerConfig {
        // Mapping between pending action hash and their timestamp
        mapping (bytes32 => uint256) pendingActions;
    }

    // wallet specific storage
    mapping (address => TokenManagerConfig) internal configs;

    // The security period
    uint256 public securityPeriod;
    // The execution window
    uint256 public securityWindow;
    // The Token storage
    ITransferStorage public transferStorage;
    // The Token price provider
    TokenPriceProvider public priceProvider;
    // The previous limit manager needed to migrate the limits
    LimitManager public oldLimitManager;

    // *************** Events *************************** //

    event AddedToWhitelist(address indexed wallet, address indexed target, uint64 whitelistAfter);
    event RemovedFromWhitelist(address indexed wallet, address indexed target);
    event PendingTransferCreated(address indexed wallet, bytes32 indexed id, uint256 indexed executeAfter,
    address token, address to, uint256 amount, bytes data);
    event PendingTransferExecuted(address indexed wallet, bytes32 indexed id);
    event PendingTransferCanceled(address indexed wallet, bytes32 indexed id);

    // *************** Constructor ********************** //

    constructor(
        IModuleRegistry _registry,
        ITransferStorage _transferStorage,
        IGuardianStorage _guardianStorage,
        address _priceProvider,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint256 _defaultLimit,
        LimitManager _oldLimitManager
    )
        BaseModule(_registry, _guardianStorage, NAME)
        LimitManager(_defaultLimit)
        public
    {
        transferStorage = _transferStorage;
        priceProvider = TokenPriceProvider(_priceProvider);
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
        oldLimitManager = _oldLimitManager;
    }

    /**
     * @dev Inits the module for a wallet by setting up the isValidSignature (EIP 1271)
     * static call redirection from the wallet to the module and copying all the parameters
     * of the daily limit from the previous implementation of the LimitManager module.
     * @param _wallet The target wallet.
     */
    function init(address _wallet) public override(BaseModule, LimitManager) onlyWallet(_wallet) {

        // setup static calls
        IWallet(_wallet).enableStaticCall(address(this), ERC1271_ISVALIDSIGNATURE_BYTES);
        IWallet(_wallet).enableStaticCall(address(this), ERC1271_ISVALIDSIGNATURE_BYTES32);

        // setup default limit for new deployment
        if (address(oldLimitManager) == address(0)) {
            super.init(_wallet);
            return;
        }
        // get limit from previous LimitManager
        uint256 current = oldLimitManager.getCurrentLimit(_wallet);
        (uint256 pending, uint64 changeAfter) = oldLimitManager.getPendingLimit(_wallet);
        // setup default limit for new wallets
        if (current == 0 && changeAfter == 0) {
            super.init(_wallet);
            return;
        }
        // migrate existing limit for existing wallets
        if (current == pending) {
            limits[_wallet].limit.current = uint128(current);
        } else {
            limits[_wallet].limit = Limit(uint128(current), uint128(pending), changeAfter);
        }
        // migrate daily pending if we are within a rolling period
        (uint256 unspent, uint64 periodEnd) = oldLimitManager.getDailyUnspent(_wallet);
        // solium-disable-next-line security/no-block-members
        if (periodEnd > now) {
            limits[_wallet].dailySpent = DailySpent(uint128(current.sub(unspent)), periodEnd);
        }
    }

    function addModule(address _wallet, address _module) external override(BaseModule, OnlyOwnerModule) onlyWalletOwner(_wallet) {
        require(registry.isRegisteredModule(_module), "BM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true);
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
        address _wallet,
        address _token,
        address _to,
        uint256 _amount,
        bytes calldata _data
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        if (isWhitelisted(_wallet, _to)) {
            // transfer to whitelist
            doTransfer(_wallet, _token, _to, _amount, _data);
        } else {
            uint256 etherAmount = (_token == ETH_TOKEN) ? _amount : priceProvider.getEtherValue(_amount, _token);
            if (checkAndUpdateDailySpent(_wallet, etherAmount)) {
                // transfer under the limit
                doTransfer(_wallet, _token, _to, _amount, _data);
            } else {
                // transfer above the limit
                (bytes32 id, uint256 executeAfter) = addPendingAction(ActionType.Transfer, _wallet, _token, _to, _amount, _data);
                emit PendingTransferCreated(_wallet, id, executeAfter, _token, _to, _amount, _data);
            }
        }
    }

    /**
    * @dev lets the owner approve an allowance of ERC20 tokens for a spender (dApp).
    * @param _wallet The target wallet.
    * @param _token The address of the token to transfer.
    * @param _spender The address of the spender
    * @param _amount The amount of tokens to approve
    */
    function approveToken(
        address _wallet,
        address _token,
        address _spender,
        uint256 _amount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        if (isWhitelisted(_wallet, _spender)) {
            // approve to whitelist
            doApproveToken(_wallet, _token, _spender, _amount);
        } else {
            // get current alowance
            uint256 currentAllowance = ERC20(_token).allowance(_wallet, _spender);
            if (_amount <= currentAllowance) {
                // approve if we reduce the allowance
                doApproveToken(_wallet, _token, _spender, _amount);
            } else {
                // check if delta is under the limit
                uint delta = _amount - currentAllowance;
                uint256 deltaInEth = priceProvider.getEtherValue(delta, _token);
                require(checkAndUpdateDailySpent(_wallet, deltaInEth), "TM: Approve above daily limit");
                // approve if under the limit
                doApproveToken(_wallet, _token, _spender, _amount);
            }
        }
    }

    /**
    * @dev lets the owner call a contract.
    * @param _wallet The target wallet.
    * @param _contract The address of the contract.
    * @param _value The amount of ETH to transfer as part of call
    * @param _data The encoded method data
    */
    function callContract(
        address _wallet,
        address _contract,
        uint256 _value,
        bytes calldata _data
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        // Make sure we don't call a module, the wallet itself, or a supported ERC20
        authoriseContractCall(_wallet, _contract);

        if (isWhitelisted(_wallet, _contract)) {
            // call to whitelist
            doCallContract(_wallet, _contract, _value, _data);
        } else {
            require(checkAndUpdateDailySpent(_wallet, _value), "TM: Call contract above daily limit");
            // call under the limit
            doCallContract(_wallet, _contract, _value, _data);
        }
    }

    /**
    * @dev lets the owner do an ERC20 approve followed by a call to a contract.
    * We assume that the contract will pull the tokens and does not require ETH.
    * @param _wallet The target wallet.
    * @param _token The token to approve.
    * @param _spender The address to approve.
    * @param _amount The amount of ERC20 tokens to approve.
    * @param _contract The address of the contract.
    * @param _data The encoded method data
    */
    function approveTokenAndCallContract(
        address _wallet,
        address _token,
        address _spender,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        // Make sure we don't call a module, the wallet itself, or a supported ERC20
        authoriseContractCall(_wallet, _contract);

        if (!isWhitelisted(_wallet, _spender)) {
            // check if the amount is under the daily limit
            // check the entire amount because the currently approved amount will be restored and should still count towards the daily limit
            uint256 valueInEth = priceProvider.getEtherValue(_amount, _token);
            require(checkAndUpdateDailySpent(_wallet, valueInEth), "TM: Approve above daily limit");
        }

        doApproveTokenAndCallContract(_wallet, _token, _spender, _amount, _contract, _data);
    }

    /**
     * @dev Adds an address to the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The address to add.
     */
    function addToWhitelist(
        address _wallet,
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
        emit AddedToWhitelist(_wallet, _target, uint64(whitelistAfter));
    }

    /**
     * @dev Removes an address from the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The address to remove.
     */
    function removeFromWhitelist(
        address _wallet,
        address _target
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(isWhitelisted(_wallet, _target), "TT: target not whitelisted");
        transferStorage.setWhitelist(_wallet, _target, 0);
        emit RemovedFromWhitelist(_wallet, _target);
    }

    /**
    * @dev Executes a pending transfer for a wallet.
    * The method can be called by anyone to enable orchestration.
    * @param _wallet The target wallet.
    * @param _token The token of the pending transfer.
    * @param _to The destination address of the pending transfer.
    * @param _amount The amount of token to transfer of the pending transfer.
    * @param _data The data associated to the pending transfer.
    * @param _block The block at which the pending transfer was created.
    */
    function executePendingTransfer(
        address _wallet,
        address _token,
        address _to,
        uint _amount,
        bytes calldata _data,
        uint _block
    )
        external
        onlyWhenUnlocked(_wallet)
    {
        bytes32 id = keccak256(abi.encodePacked(ActionType.Transfer, _token, _to, _amount, _data, _block));
        uint executeAfter = configs[_wallet].pendingActions[id];
        require(executeAfter > 0, "TT: unknown pending transfer");
        uint executeBefore = executeAfter.add(securityWindow);
        // solium-disable-next-line security/no-block-members
        require(executeAfter <= now && now <= executeBefore, "TT: transfer outside of the execution window");
        delete configs[_wallet].pendingActions[id];
        doTransfer(_wallet, _token, _to, _amount, _data);
        emit PendingTransferExecuted(_wallet, id);
    }

    function cancelPendingTransfer(
        address _wallet,
        bytes32 _id
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(configs[_wallet].pendingActions[_id] > 0, "TT: unknown pending action");
        delete configs[_wallet].pendingActions[_id];
        emit PendingTransferCanceled(_wallet, _id);
    }

    /**
     * @dev Lets the owner of a wallet change its daily limit.
     * The limit is expressed in ETH. Changes to the limit take 24 hours.
     * @param _wallet The target wallet.
     * @param _newLimit The new limit.
     */
    function changeLimit(address _wallet, uint256 _newLimit) external onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        changeLimit(_wallet, _newLimit, securityPeriod);
    }

    /**
     * @dev Convenience method to disable the limit
     * The limit is disabled by setting it to an arbitrary large value.
     * @param _wallet The target wallet.
     */
    function disableLimit(address _wallet) external onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        disableLimit(_wallet, securityPeriod);
    }

    /**
    * @dev Checks if an address is whitelisted for a wallet.
    * @param _wallet The target wallet.
    * @param _target The address.
    * @return _isWhitelisted true if the address is whitelisted.
    */
    function isWhitelisted(address _wallet, address _target) public view returns (bool _isWhitelisted) {
        uint whitelistAfter = transferStorage.getWhitelist(_wallet, _target);
        // solium-disable-next-line security/no-block-members
        return whitelistAfter > 0 && whitelistAfter < now;
    }

    /**
    * @dev Gets the info of a pending transfer for a wallet.
    * @param _wallet The target wallet.
    * @param _id The pending transfer ID.
    * @return _executeAfter The epoch time at which the pending transfer can be executed.
    */
    function getPendingTransfer(address _wallet, bytes32 _id) external view returns (uint64 _executeAfter) {
        _executeAfter = uint64(configs[address(_wallet)].pendingActions[_id]);
    }

    /**
    * @dev Implementation of EIP 1271.
    * Should return whether the signature provided is valid for the provided data.
    * @param _data Arbitrary length data signed on the behalf of address(this)
    * @param _signature Signature byte array associated with _data
    */
    function isValidSignature(bytes calldata _data, bytes calldata _signature) external view returns (bytes4) {
        bytes32 msgHash = keccak256(abi.encodePacked(_data));
        isValidSignature(msgHash, _signature);
        return ERC1271_ISVALIDSIGNATURE_BYTES;
    }

    /**
    * @dev Implementation of EIP 1271.
    * Should return whether the signature provided is valid for the provided data.
    * @param _msgHash Hash of a message signed on the behalf of address(this)
    * @param _signature Signature byte array associated with _msgHash
    */
    function isValidSignature(bytes32 _msgHash, bytes memory _signature) public view returns (bytes4) {
        require(_signature.length == 65, "TM: invalid signature length");
        address signer = recoverSigner(_msgHash, _signature, 0);
        require(isOwner(msg.sender, signer), "TM: Invalid signer");
        return ERC1271_ISVALIDSIGNATURE_BYTES32;
    }

    // *************** Internal Functions ********************* //

    /**
     * @dev Creates a new pending action for a wallet.
     * @param _action The target action.
     * @param _wallet The target wallet.
     * @param _token The target token for the action.
     * @param _to The recipient of the action.
     * @param _amount The amount of token associated to the action.
     * @param _data The data associated to the action.
     * @return id The identifier for the new pending action.
     * @return executeAfter The time when the action can be executed
     */
    function addPendingAction(
        ActionType _action,
        address _wallet,
        address _token,
        address _to,
        uint _amount,
        bytes memory _data
    )
        internal
        returns (bytes32 id, uint256 executeAfter)
    {
        id = keccak256(abi.encodePacked(_action, _token, _to, _amount, _data, block.number));
        require(configs[_wallet].pendingActions[id] == 0, "TM: duplicate pending action");
        // solium-disable-next-line security/no-block-members
        executeAfter = now.add(securityPeriod);
        configs[_wallet].pendingActions[id] = executeAfter;
    }

    /**
    * @dev Make sure a contract call is not trying to call a module, the wallet itself, or a supported ERC20.
    * @param _wallet The target wallet.
    * @param _contract The address of the contract.
     */
    function authoriseContractCall(address _wallet, address _contract) internal view {
        require(
            _contract != _wallet && // not the wallet itself
            !IWallet(_wallet).authorised(_contract) && // not an authorised module
            (priceProvider.cachedPrices(_contract) == 0 || isLimitDisabled(_wallet)), // not an ERC20 listed in the provider (or limit disabled)
            "TM: Forbidden contract");
    }

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides refund to add the refund in the daily limit.
    function refund(
        address _wallet,
        uint _gasUsed,
        uint _gasPrice,
        uint _gasLimit,
        uint _signatures,
        address _relayer
    )
        internal override
    {
        // 21000 (transaction) + 7620 (execution of refund) + 7324 (execution of updateDailySpent) + 672 to log the event + _gasUsed
        uint256 amount = 36616 + _gasUsed;
        if (_gasPrice > 0 && _signatures > 0 && amount <= _gasLimit) {
            if (_gasPrice > tx.gasprice) {
                amount = amount * tx.gasprice;
            } else {
                amount = amount * _gasPrice;
            }
            checkAndUpdateDailySpent(_wallet, amount);
            invokeWallet(_wallet, _relayer, amount, EMPTY_BYTES);
        }
    }

    // Overrides verifyRefund to add the refund in the daily limit.
    function verifyRefund(address _wallet, uint _gasUsed, uint _gasPrice, uint _signatures) internal override view returns (bool) {
        if (_gasPrice > 0 && _signatures > 0 && (
            _wallet.balance < _gasUsed * _gasPrice ||
            isWithinDailyLimit(_wallet, getCurrentLimit(_wallet), _gasUsed * _gasPrice) == false ||
            IWallet(_wallet).authorised(address(this)) == false
        ))
        {
            return false;
        }
        return true;
    }
}
