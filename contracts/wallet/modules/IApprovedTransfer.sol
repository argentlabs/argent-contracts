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

/**
 * @title IApprovedTransfer
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface IApprovedTransfer {
  /**
    * @notice Transfers tokens (ETH or ERC20) from a wallet.
    * @param _token The address of the token to transfer.
    * @param _to The destination address
    * @param _amount The amount of token to transfer
    * @param _data  The data for the transaction (only for ETH transfers)
    */
  function transferToken(address _token, address _to, uint256 _amount, bytes calldata _data) external;
  
  /**
    * @notice Call a contract.
    * @param _contract The address of the contract.
    * @param _value The amount of ETH to transfer as part of call
    * @param _data The encoded method data
    */
    function callContract(address _contract, uint256 _value, bytes calldata _data) external;

    /**
    * @notice Lets the owner do an ERC20 approve followed by a call to a contract.
    * The address to approve may be different than the contract to call.
    * We assume that the contract does not require ETH.
    * @param _token The token to approve.
    * @param _spender The address to approve.
    * @param _amount The amount of ERC20 tokens to approve.
    * @param _contract The contract to call.
    * @param _data The encoded method data
    */
    function approveTokenAndCallContract(
        address _token,
        address _spender,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    ) external;

    /**
     * @notice Changes the daily limit. The change is immediate.
     * @param _newLimit The new limit.
     */
    function changeLimit(uint256 _newLimit) external;

        /**
    * @notice lets the owner wrap ETH into WETH, approve the WETH and call a contract.
    * The address to approve may be different than the contract to call.
    * We assume that the contract does not require ETH.
    * @param _spender The address to approve.
    * @param _amount The amount of ERC20 tokens to approve.
    * @param _contract The contract to call.
    * @param _data The encoded method data
    */
    function approveWethAndCallContract(
        address _spender,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external;
}