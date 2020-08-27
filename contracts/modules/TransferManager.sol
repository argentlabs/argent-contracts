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
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./common/Utils.sol";
import "./common/OnlyOwnerFeature.sol";
import "./common/BaseTransfer.sol";
import "./common/LimitUtils.sol";
import "../infrastructure/storage/ILimitStorage.sol";
import "../infrastructure/storage/ITransferStorage.sol";
import "../infrastructure/storage/ITokenPriceStorage.sol";
import "../../lib/other/ERC20.sol";

/**
 * @title TransferManager
 * @notice Feature to transfer and approve tokens (ETH or ERC20) or data (contract call) based on a security context (daily limit, whitelist, etc).
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TransferManager is OnlyOwnerFeature, BaseTransfer {

    bytes32 constant NAME = "TransferManager";

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
    // The default limit
    uint128 public defaultLimit;
    // The Token storage
    ITransferStorage public transferStorage;
    // The previous limit manager needed to migrate the limits
    TransferManager public oldTransferManager;
    // The limit storage
    ILimitStorage public limitStorage;
    // The token price storage
    ITokenPriceStorage public tokenPriceStorage;

    // *************** Events *************************** //

    event AddedToWhitelist(address indexed wallet, address indexed target, uint64 whitelistAfter);
    event RemovedFromWhitelist(address indexed wallet, address indexed target);
    event PendingTransferCreated(address indexed wallet, bytes32 indexed id, uint256 indexed executeAfter,
    address token, address to, uint256 amount, bytes data);
    event PendingTransferExecuted(address indexed wallet, bytes32 indexed id);
    event PendingTransferCanceled(address indexed wallet, bytes32 indexed id);
    event DailyLimitMigrated(address indexed wallet, uint256 currentDailyLimit, uint256 pendingDailyLimit, uint256 changeDailyLimitAfter);
    event DailyLimitDisabled(address indexed wallet, uint256 securityPeriod);

    // *************** Constructor ********************** //

    constructor(
        IModuleRegistry _registry,
        ITransferStorage _transferStorage,
        IGuardianStorage _guardianStorage,
        ILimitStorage _limitStorage,
        ITokenPriceStorage _tokenPriceStorage,
        IVersionManager _versionManager,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint256 _defaultLimit,
        address _wethToken,
        TransferManager _oldTransferManager
    )
        BaseFeature(_registry, _guardianStorage, _versionManager, NAME)
        BaseTransfer(_wethToken)
        public
    {
        transferStorage = _transferStorage;
        limitStorage = _limitStorage;
        tokenPriceStorage = _tokenPriceStorage;
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
        defaultLimit = LimitUtils.safe128(_defaultLimit);
        oldTransferManager = _oldTransferManager;
    }

    /**
     * @inheritdoc IFeature
     */
    function getStaticCallSignatures() external virtual override view returns (bytes4[] memory _sigs) {
        _sigs = new bytes4[](1);
        _sigs[0] = ERC1271_ISVALIDSIGNATURE_BYTES32;
    }


    /**
     * @notice Inits the feature for a wallet by setting up the isValidSignature (EIP 1271)
     * static call redirection from the wallet to the feature and copying all the parameters
     * of the daily limit from the previous implementation of the LimitManager module.
     * @param _wallet The target wallet.
     */
    function init(address _wallet) public override(BaseFeature) onlyVersionManager {

        if (address(oldTransferManager) == address(0)) {
            limitStorage.setLimit(_wallet, ILimitStorage.Limit(defaultLimit, 0, 0));
        } else {
            uint256 current = oldTransferManager.getCurrentLimit(_wallet);
            (uint256 pending, uint64 changeAfter) = oldTransferManager.getPendingLimit(_wallet);
            if (current == 0 && changeAfter == 0) {
                // new wallet: we setup the default limit
                limitStorage.setLimit(_wallet, ILimitStorage.Limit(defaultLimit, 0, 0));
            } else {
                // migrate limit and daily spent (if we are in a rolling period)
                (uint256 unspent, uint64 periodEnd) = oldTransferManager.getDailyUnspent(_wallet);

                if (periodEnd < block.timestamp) {
                    limitStorage.setLimit(_wallet, ILimitStorage.Limit(LimitUtils.safe128(current), LimitUtils.safe128(pending), changeAfter));
                } else {
                    limitStorage.setLimitAndDailySpent(
                        _wallet,
                        ILimitStorage.Limit(LimitUtils.safe128(current), LimitUtils.safe128(pending), changeAfter),
                        ILimitStorage.DailySpent(LimitUtils.safe128(current.sub(unspent)), periodEnd)
                    );
                }

                emit DailyLimitMigrated(_wallet, current, pending, changeAfter);
            }
        }
    }

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(
        address _wallet,
        bytes calldata _data
    )
        external
        override(BaseFeature, OnlyOwnerFeature)
        view
        returns (uint256, OwnerSignature)
    {
        return (1, OwnerSignature.Required);
    }

    // *************** External/Public Functions ********************* //

    /**
    * @notice Lets the owner transfer tokens (ETH or ERC20) from a wallet.
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
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        if (isWhitelisted(_wallet, _to)) {
            // transfer to whitelist
            doTransfer(_wallet, _token, _to, _amount, _data);
        } else {
            uint256 etherAmount = (_token == ETH_TOKEN) ? _amount : LimitUtils.getEtherValue(tokenPriceStorage, _amount, _token);
            if (LimitUtils.checkAndUpdateDailySpent(limitStorage, _wallet, etherAmount)) {
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
    * @notice Lets the owner approve an allowance of ERC20 tokens for a spender (dApp).
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
        onlyWalletOwnerOrFeature(_wallet)
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
                uint256 deltaInEth = LimitUtils.getEtherValue(tokenPriceStorage, delta, _token);
                require(LimitUtils.checkAndUpdateDailySpent(limitStorage, _wallet, deltaInEth), "TM: Approve above daily limit");
                // approve if under the limit
                doApproveToken(_wallet, _token, _spender, _amount);
            }
        }
    }

    /**
    * @notice Lets the owner call a contract.
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
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
        onlyAuthorisedContractCall(_wallet, _contract)
    {
        checkAndUpdateDailySpentIfNeeded(_wallet, ETH_TOKEN, _value, _contract);
        doCallContract(_wallet, _contract, _value, _data);
    }

    /**
    * @notice Lets the owner do an ERC20 approve followed by a call to a contract.
    * We assume that the contract will pull the tokens and does not require ETH.
    * @param _wallet The target wallet.
    * @param _token The token to approve.
    * @param _proxy The address to approve, which may be different from the contract being called.
    * @param _amount The amount of ERC20 tokens to approve.
    * @param _contract The address of the contract.
    * @param _data The encoded method data
    */
    function approveTokenAndCallContract(
        address _wallet,
        address _token,
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
        onlyAuthorisedContractCall(_wallet, _contract)
    {
        checkAndUpdateDailySpentIfNeeded(_wallet, _token, _amount, _contract);
        doApproveTokenAndCallContract(_wallet, _token, _proxy, _amount, _contract, _data);
    }

    /**
    * @notice Lets the owner wrap ETH into WETH, approve the WETH and call a contract.
    * We assume that the contract will pull the tokens and does not require ETH.
    * @param _wallet The target wallet.
    * @param _proxy The address to approve, which may be different from the contract being called.
    * @param _amount The amount of ETH to wrap and approve.
    * @param _contract The address of the contract.
    * @param _data The encoded method data
    */
    function approveWethAndCallContract(
        address _wallet,
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
        onlyAuthorisedContractCall(_wallet, _contract)
    {
        checkAndUpdateDailySpentIfNeeded(_wallet, wethToken, _amount, _contract);
        doApproveWethAndCallContract(_wallet, _proxy, _amount, _contract, _data);
    }

    /**
     * @notice Adds an address to the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The address to add.
     */
    function addToWhitelist(
        address _wallet,
        address _target
    )
        external
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(!isWhitelisted(_wallet, _target), "TT: target already whitelisted");

        uint256 whitelistAfter = block.timestamp.add(securityPeriod);
        setWhitelist(_wallet, _target, whitelistAfter);
        emit AddedToWhitelist(_wallet, _target, uint64(whitelistAfter));
    }

    /**
     * @notice Removes an address from the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The address to remove.
     */
    function removeFromWhitelist(
        address _wallet,
        address _target
    )
        external
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        setWhitelist(_wallet, _target, 0);
        emit RemovedFromWhitelist(_wallet, _target);
    }

    /**
    * @notice Executes a pending transfer for a wallet.
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

        require(executeAfter <= block.timestamp && block.timestamp <= executeBefore, "TT: transfer outside of the execution window");
        delete configs[_wallet].pendingActions[id];
        doTransfer(_wallet, _token, _to, _amount, _data);
        emit PendingTransferExecuted(_wallet, id);
    }

    function cancelPendingTransfer(
        address _wallet,
        bytes32 _id
    )
        external
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(configs[_wallet].pendingActions[_id] > 0, "TT: unknown pending action");
        delete configs[_wallet].pendingActions[_id];
        emit PendingTransferCanceled(_wallet, _id);
    }

    /**
     * @notice Lets the owner of a wallet change its daily limit.
     * The limit is expressed in ETH. Changes to the limit take 24 hours.
     * @param _wallet The target wallet.
     * @param _newLimit The new limit.
     */
    function changeLimit(address _wallet, uint256 _newLimit) external onlyWalletOwnerOrFeature(_wallet) onlyWhenUnlocked(_wallet) {
        ILimitStorage.Limit memory limit = LimitUtils.changeLimit(limitStorage, _wallet, _newLimit, securityPeriod);
        emit LimitChanged(_wallet, _newLimit, limit.changeAfter);
    }

    /**
     * @notice Convenience method to disable the limit
     * The limit is disabled by setting it to an arbitrary large value.
     * @param _wallet The target wallet.
     */
    function disableLimit(address _wallet) external onlyWalletOwnerOrFeature(_wallet) onlyWhenUnlocked(_wallet) {
        LimitUtils.disableLimit(limitStorage, _wallet, securityPeriod);
        emit DailyLimitDisabled(_wallet, securityPeriod);
    }

    /**
    * @notice Gets the current daily limit for a wallet.
    * @param _wallet The target wallet.
    * @return _currentLimit The current limit expressed in ETH.
    */
    function getCurrentLimit(address _wallet) external view returns (uint256 _currentLimit) {
        ILimitStorage.Limit memory limit = limitStorage.getLimit(_wallet);
        return LimitUtils.currentLimit(limit);
    }

    /**
    * @notice Returns whether the daily limit is disabled for a wallet.
    * @param _wallet The target wallet.
    * @return _limitDisabled true if the daily limit is disabled, false otherwise.
    */
    function isLimitDisabled(address _wallet) public view returns (bool _limitDisabled) {
        return LimitUtils.isLimitDisabled(limitStorage, _wallet);
    }

    /**
    * @notice Gets a pending limit for a wallet if any.
    * @param _wallet The target wallet.
    * @return _pendingLimit The pending limit (in ETH).
    * @return _changeAfter The time at which the pending limit will become effective.
    */
    function getPendingLimit(address _wallet) external view returns (uint256 _pendingLimit, uint64 _changeAfter) {
        ILimitStorage.Limit memory limit = limitStorage.getLimit(_wallet);

        return ((block.timestamp < limit.changeAfter)? (limit.pending, uint64(limit.changeAfter)) : (0,0));
    }

    /**
    * @notice Gets the amount of tokens that has not yet been spent during the current period.
    * @param _wallet The target wallet.
    * @return _unspent The amount of tokens (in ETH) that has not been spent yet.
    * @return _periodEnd The end of the daily period.
    */
    function getDailyUnspent(address _wallet) external view returns (uint256 _unspent, uint64 _periodEnd) {
        (
            ILimitStorage.Limit memory limit,
            ILimitStorage.DailySpent memory dailySpent
        ) = limitStorage.getLimitAndDailySpent(_wallet);
        uint256 currentLimit = LimitUtils.currentLimit(limit);

        if (block.timestamp > dailySpent.periodEnd) {
            return (currentLimit, uint64(block.timestamp.add(24 hours)));
        } else if (dailySpent.alreadySpent < currentLimit) {
            return (currentLimit.sub(dailySpent.alreadySpent), dailySpent.periodEnd);
        } else {
            return (0, dailySpent.periodEnd);
        }
    }

    /**
    * @notice Checks if an address is whitelisted for a wallet.
    * @param _wallet The target wallet.
    * @param _target The address.
    * @return _isWhitelisted true if the address is whitelisted.
    */
    function isWhitelisted(address _wallet, address _target) public view returns (bool _isWhitelisted) {
        uint whitelistAfter = transferStorage.getWhitelist(_wallet, _target);
        
        return whitelistAfter > 0 && whitelistAfter < block.timestamp;
    }

    /**
    * @notice Gets the info of a pending transfer for a wallet.
    * @param _wallet The target wallet.
    * @param _id The pending transfer ID.
    * @return _executeAfter The epoch time at which the pending transfer can be executed.
    */
    function getPendingTransfer(address _wallet, bytes32 _id) external view returns (uint64 _executeAfter) {
        _executeAfter = uint64(configs[address(_wallet)].pendingActions[_id]);
    }

    /**
    * @notice Implementation of EIP 1271.
    * Should return whether the signature provided is valid for the provided data.
    * @param _msgHash Hash of a message signed on the behalf of address(this)
    * @param _signature Signature byte array associated with _msgHash
    */
    function isValidSignature(bytes32 _msgHash, bytes memory _signature) public view returns (bytes4) {
        require(_signature.length == 65, "TM: invalid signature length");
        address signer = Utils.recoverSigner(_msgHash, _signature, 0);
        require(isOwner(msg.sender, signer), "TM: Invalid signer");
        return ERC1271_ISVALIDSIGNATURE_BYTES32;
    }

    // *************** Internal Functions ********************* //

    /**
     * @notice Creates a new pending action for a wallet.
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

        executeAfter = block.timestamp.add(securityPeriod);
        configs[_wallet].pendingActions[id] = executeAfter;
    }

    /**
    * @notice Make sure a contract call is not trying to call a supported ERC20.
    * @param _wallet The target wallet.
    * @param _contract The address of the contract.
     */
    function coveredByDailyLimit(address _wallet, address _contract) internal view returns (bool) {
        return (tokenPriceStorage.getTokenPrice(_contract) > 0 && !isLimitDisabled(_wallet));
    }

    /**
    * @notice Verify and update the daily spent if the spender is not whitelisted.
    * Reverts if the daily spent is insufficient or if the contract to call is
    * protected by the daily limit (i.e. is a token contract).
    * @param _wallet The target wallet.
    * @param _token The token that the spender will spend.
    * @param _amount The amount of ERC20 or ETH that the spender will spend.
    * @param _contract The address of the contract called by the wallet for the spend to occur.
    */

    function checkAndUpdateDailySpentIfNeeded(
        address _wallet,
        address _token,
        uint256 _amount,
        address _contract
    )
        internal
    {
        if (!isWhitelisted(_wallet, _contract)) {
            // Make sure we don't call a supported ERC20 that's not whitelisted
            require(!coveredByDailyLimit(_wallet, _contract), "TM: Forbidden contract");

            // Check if the amount is under the daily limit.
            // Check the entire amount because the currently approved amount will be restored and should still count towards the daily limit
            uint256 valueInEth;
            if (_token == ETH_TOKEN || _token == wethToken) {
                valueInEth = _amount;
            } else {
                valueInEth = LimitUtils.getEtherValue(tokenPriceStorage, _amount, _token);
            }
            require(LimitUtils.checkAndUpdateDailySpent(limitStorage, _wallet, valueInEth), "TM: Approve above daily limit");
        }
    }

    // *************** Internal functions ************************ //

    function setWhitelist(address _wallet, address _target, uint256 _whitelistAfter) internal {
        versionManager.invokeVersionManager(
            _wallet,
            address(transferStorage), 
            abi.encodeWithSelector(transferStorage.setWhitelist.selector, _wallet, _target, _whitelistAfter)
        );
    }
}
