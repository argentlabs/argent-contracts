// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

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

import "../base/DataTypes.sol";
import "../../infrastructure/ITokenPriceRegistry.sol";

/**
 * @title IRelayerManager
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface IRelayerManager {
    event TransactionExecuted(address indexed wallet, bool indexed success, bytes returnData, bytes32 signedHash);
    event Refund(address indexed wallet, address indexed refundAddress, address refundToken, uint256 refundAmount);

    /**
    * @notice Gets the current nonce for a wallet.
    */
    function getNonce() external pure returns (uint256 nonce);

   /**
    * @notice Checks if a transaction identified by its sign hash has already been executed.
    * @param _signHash The sign hash of the transaction.
    */
    function isExecutedTx(bytes32 _signHash) external view returns (bool executed);

    /**
    * @notice Executes a relayed transaction.
    * @param _data The data for the relayed transaction
    * @param _nonce The nonce used to prevent replay attacks.
    * @param _signatures The signatures as a concatenated byte array.
    * @param _gasPrice The gas price to use for the gas refund.
    * @param _gasLimit The gas limit to use for the gas refund.
    * @param _refundToken The token to use for the gas refund.
    * @param _refundAddress The address refunded to prevent front-running.
    */
    function execute(
        bytes calldata _data,
        uint256 _nonce,
        bytes calldata _signatures,
        uint256 _gasPrice,
        uint256 _gasLimit,
        address _refundToken,
        address payable _refundAddress
    )
        external
        returns (bool);

    /**
    * @notice Gets the number of valid signatures that must be provided to execute a
    * specific relayed transaction.
    * @param _data The data of the relayed transaction.
    * @return The number of required signatures and the wallet owner signature requirement.
    */
    function getRequiredSignatures(bytes calldata _data) external view returns (uint256, DataTypes.OwnerSignature);
}