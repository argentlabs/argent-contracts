/*

    Copyright 2019 dYdX Trading Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.5.7;
pragma experimental ABIEncoderV2;

import { MultiSig } from "./MultiSig.sol";


/**
 * @title DelayedMultiSig
 * @author dYdX
 *
 * Multi-Signature Wallet with delay in execution.
 * Allows multiple parties to execute a transaction after a time lock has passed.
 * Adapted from Amir Bandeali's MultiSigWalletWithTimeLock contract.

 * Logic Changes:
 *  - Only owners can execute transactions
 *  - Require that each transaction succeeds
 *  - Added function to execute multiple transactions within the same Ethereum transaction
 */
contract DelayedMultiSig is
    MultiSig
{
    // ============ Events ============

    event ConfirmationTimeSet(uint256 indexed transactionId, uint256 confirmationTime);
    event TimeLockChange(uint32 secondsTimeLocked);

    // ============ Storage ============

    uint32 public secondsTimeLocked;
    mapping (uint256 => uint256) public confirmationTimes;

    // ============ Modifiers ============

    modifier notFullyConfirmed(
        uint256 transactionId
    ) {
        require(
            !isConfirmed(transactionId),
            "TX_FULLY_CONFIRMED"
        );
        _;
    }

    modifier fullyConfirmed(
        uint256 transactionId
    ) {
        require(
            isConfirmed(transactionId),
            "TX_NOT_FULLY_CONFIRMED"
        );
        _;
    }

    modifier pastTimeLock(
        uint256 transactionId
    ) {
        require(
            block.timestamp >= confirmationTimes[transactionId] + secondsTimeLocked,
            "TIME_LOCK_INCOMPLETE"
        );
        _;
    }

    // ============ Constructor ============

    /**
     * Contract constructor sets initial owners, required number of confirmations, and time lock.
     *
     * @param  _owners             List of initial owners.
     * @param  _required           Number of required confirmations.
     * @param  _secondsTimeLocked  Duration needed after a transaction is confirmed and before it
     *                             becomes executable, in seconds.
     */
    constructor (
        address[] memory _owners,
        uint256 _required,
        uint32 _secondsTimeLocked
    )
        public
        MultiSig(_owners, _required)
    {
        secondsTimeLocked = _secondsTimeLocked;
    }

    // ============ Wallet-Only Functions ============

    /**
     * Changes the duration of the time lock for transactions.
     *
     * @param  _secondsTimeLocked  Duration needed after a transaction is confirmed and before it
     *                             becomes executable, in seconds.
     */
    function changeTimeLock(
        uint32 _secondsTimeLocked
    )
        public
        onlyWallet
    {
        secondsTimeLocked = _secondsTimeLocked;
        emit TimeLockChange(_secondsTimeLocked);
    }

    // ============ Owner Functions ============

    /**
     * Allows an owner to confirm a transaction.
     * Overrides the function in MultiSig.
     *
     * @param  transactionId  Transaction ID.
     */
    function confirmTransaction(
        uint256 transactionId
    )
        public
        ownerExists(msg.sender)
        transactionExists(transactionId)
        notConfirmed(transactionId, msg.sender)
        notFullyConfirmed(transactionId)
    {
        confirmations[transactionId][msg.sender] = true;
        emit Confirmation(msg.sender, transactionId);
        if (isConfirmed(transactionId)) {
            setConfirmationTime(transactionId, block.timestamp);
        }
    }

    /**
     * Allows an owner to execute a confirmed transaction.
     * Overrides the function in MultiSig.
     *
     * @param  transactionId  Transaction ID.
     */
    function executeTransaction(
        uint256 transactionId
    )
        public
        ownerExists(msg.sender)
        notExecuted(transactionId)
        fullyConfirmed(transactionId)
        pastTimeLock(transactionId)
    {
        Transaction storage txn = transactions[transactionId];
        txn.executed = true;
        bool success = externalCall(
            txn.destination,
            txn.value,
            txn.data.length,
            txn.data
        );
        require(
            success,
            "TX_REVERTED"
        );
        emit Execution(transactionId);
    }

    /**
     * Allows an owner to execute multiple confirmed transactions.
     *
     * @param  transactionIds  List of transaction IDs.
     */
    function executeMultipleTransactions(
        uint256[] memory transactionIds
    )
        public
        ownerExists(msg.sender)
    {
        for (uint256 i = 0; i < transactionIds.length; i++) {
            executeTransaction(transactionIds[i]);
        }
    }

    // ============ Helper Functions ============

    /**
     * Sets the time of when a submission first passed.
     */
    function setConfirmationTime(
        uint256 transactionId,
        uint256 confirmationTime
    )
        internal
    {
        confirmationTimes[transactionId] = confirmationTime;
        emit ConfirmationTimeSet(transactionId, confirmationTime);
    }
}
