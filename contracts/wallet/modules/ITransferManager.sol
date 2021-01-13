// Copyright (C) 2020  Argent Labs Ltd. <https://argent.xyz>

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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

import "../../infrastructure/ITokenPriceRegistry.sol";

/**
 * @title ITransferStorage
 * @notice TransferStorage interface
 */
interface ITransferManager {
    event AddedToWhitelist(address indexed wallet, address indexed target, uint64 whitelistAfter);
    event RemovedFromWhitelist(address indexed wallet, address indexed target);
    event PendingTransferCreated(address indexed wallet, bytes32 indexed id, uint256 indexed executeAfter,
    address token, address to, uint256 amount, bytes data);
    event PendingTransferExecuted(address indexed wallet, bytes32 indexed id);
    event PendingTransferCanceled(address indexed wallet, bytes32 indexed id);
    event DailyLimitMigrated(address indexed wallet, uint256 currentDailyLimit, uint256 pendingDailyLimit, uint256 changeDailyLimitAfter);
    event DailyLimitDisabled(address indexed wallet, uint256 securityPeriod);

    /**
    * @notice Implementation of EIP 1271.
    * Should return whether the signature provided is valid for the provided data.
    * @param _msgHash Hash of a message signed on the behalf of address(this)
    * @param _signature Signature byte array associated with _msgHash
    */
    function isValidSignature(bytes32 _msgHash, bytes memory _signature) external view returns (bytes4);

    /**
    * @notice Lets the owner transfer tokens (ETH or ERC20) from a wallet.
    * @param _token The address of the token to transfer.
    * @param _to The destination address
    * @param _amount The amoutn of token to transfer
    * @param _data The data for the transaction
    */
    function transferToken(address _token, address payable _to, uint256 _amount, bytes calldata _data) external;

    /**
    * @notice Lets the owner approve an allowance of ERC20 tokens for a spender (dApp).
    * @param _token The address of the token to transfer.
    * @param _spender The address of the spender
    * @param _amount The amount of tokens to approve
    */
    function approveToken(address _token, address _spender, uint256 _amount) external;

    /**
    * @notice Lets the owner call a contract.
    * @param _contract The address of the contract.
    * @param _value The amount of ETH to transfer as part of call
    * @param _data The encoded method data
    */
    function callContract(address _contract, uint256 _value, bytes calldata _data) external;

    /**
    * @notice Lets the owner do an ERC20 approve followed by a call to a contract.
    * We assume that the contract will pull the tokens and does not require ETH.
    * @param _token The token to approve.
    * @param _proxy The address to approve, which may be different from the contract being called.
    * @param _amount The amount of ERC20 tokens to approve.
    * @param _contract The address of the contract.
    * @param _data The encoded method data
    */
    function approveTokenAndCallContract(
        address _token,
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    ) external;

    /**
    * @notice Lets the owner wrap ETH into WETH, approve the WETH and call a contract.
    * We assume that the contract will pull the tokens and does not require ETH.
    * @param _proxy The address to approve, which may be different from the contract being called.
    * @param _amount The amount of ETH to wrap and approve.
    * @param _contract The address of the contract.
    * @param _data The encoded method data
    */
    function approveWethAndCallContract(
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    ) external;

    /**
    * @notice Gets the info of a pending transfer for a wallet.
    * @param _id The pending transfer ID.
    * @return _executeAfter The epoch time at which the pending transfer can be executed.
    */
    function getPendingTransfer(bytes32 _id) external view returns (uint64 _executeAfter);

    /**
    * @notice Executes a pending transfer for a wallet.
    * The method can be called by anyone to enable orchestration.
    * @param _token The token of the pending transfer.
    * @param _to The destination address of the pending transfer.
    * @param _amount The amount of token to transfer of the pending transfer.
    * @param _data The data associated to the pending transfer.
    * @param _block The block at which the pending transfer was created.
    */
    function executePendingTransfer(
        address _token,
        address payable _to,
        uint _amount,
        bytes calldata _data,
        uint _block
    ) external;

    function cancelPendingTransfer(bytes32 _id) external;

    /**
     * @notice Adds an address to the whitelist of a wallet.
     * @param _target The address to add.
     */
    function addToWhitelist(address _target) external;

    /**
     * @notice Removes an address from the whitelist of a wallet.
     * @param _target The address to remove.
     */
    function removeFromWhitelist(address _target) external;

    /**
    * @notice Checks if an address is whitelisted for a wallet.
    * @param _target The address.
    * @return _isWhitelisted true if the address is whitelisted.
    */
    function isWhitelisted(address _target) external view returns (bool _isWhitelisted);

    /**
     * @notice Lets the owner of a wallet change its daily limit.
     * The limit is expressed in ETH. Changes to the limit take 24 hours.
     * Decreasing the limit is immediate while increasing the limit is pending for the security period.
     * @param _newLimit The new limit.
     */
    function changeLimit(uint256 _newLimit) external;

    /**
     * @notice Convenience method to disable the limit
     * The limit is disabled by setting it to an arbitrary large value.
     */
    function disableLimit() external;

    /**
    * @notice Gets the current daily limit for a wallet.
    * @return _currentLimit The current limit expressed in ETH.
    */
    function getCurrentLimit() external view returns (uint256 _currentLimit);

    /**
    * @notice Returns whether the daily limit is disabled for a wallet.
    * @return _limitDisabled true if the daily limit is disabled, false otherwise.
    */
    function isLimitDisabled() external view returns (bool _limitDisabled);

    /**
    * @notice Gets a pending limit for a wallet if any.
    * @return _pendingLimit The pending limit (in ETH).
    * @return _changeAfter The time at which the pending limit will become effective.
    */
    function getPendingLimit() external view returns (uint256 _pendingLimit, uint64 _changeAfter);

    /**
    * @notice Gets the amount of tokens that has not yet been spent during the current period.
    * @return _unspent The amount of tokens (in ETH) that has not been spent yet.
    * @return _periodEnd The end of the daily period.
    */
    function getDailyUnspent() external view returns (uint256 _unspent, uint64 _periodEnd);
}