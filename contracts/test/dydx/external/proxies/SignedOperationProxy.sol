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

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Account } from "../../protocol/lib/Account.sol";
import { Actions } from "../../protocol/lib/Actions.sol";
import { Require } from "../../protocol/lib/Require.sol";
import { Types } from "../../protocol/lib/Types.sol";
import { OnlySolo } from "../helpers/OnlySolo.sol";
import { TypedSignature } from "../lib/TypedSignature.sol";


/**
 * @title SignedOperationProxy
 * @author dYdX
 *
 * Contract for sending operations on behalf of others
 */
contract SignedOperationProxy is
    OnlySolo,
    Ownable
{
    using SafeMath for uint256;

    // ============ Constants ============

    bytes32 constant private FILE = "SignedOperationProxy";

    // EIP191 header for EIP712 prefix
    bytes2 constant private EIP191_HEADER = 0x1901;

    // EIP712 Domain Name value
    string constant private EIP712_DOMAIN_NAME = "SignedOperationProxy";

    // EIP712 Domain Version value
    string constant private EIP712_DOMAIN_VERSION = "1.0";

    // EIP712 encodeType of EIP712Domain
    bytes constant private EIP712_DOMAIN_STRING = abi.encodePacked(
        "EIP712Domain(",
        "string name,",
        "string version,",
        "uint256 chainId,",
        "address verifyingContract",
        ")"
    );

    // EIP712 encodeType of Operation
    bytes constant private EIP712_OPERATION_STRING = abi.encodePacked(
        "Operation(",
        "Action[] actions,",
        "uint256 expiration,",
        "uint256 salt,",
        "address sender",
        ")"
    );

    // EIP712 encodeType of Action
    bytes constant private EIP712_ACTION_STRING = abi.encodePacked(
        "Action(",
        "uint8 actionType,",
        "address accountOwner,",
        "uint256 accountNumber,",
        "AssetAmount assetAmount,",
        "uint256 primaryMarketId,",
        "uint256 secondaryMarketId,",
        "address otherAddress,",
        "address otherAccountOwner,",
        "uint256 otherAccountNumber,",
        "bytes data",
        ")"
    );

    // EIP712 encodeType of AssetAmount
    bytes constant private EIP712_ASSET_AMOUNT_STRING = abi.encodePacked(
        "AssetAmount(",
        "bool sign,",
        "uint8 denomination,",
        "uint8 ref,",
        "uint256 value",
        ")"
    );

    // EIP712 typeHash of EIP712Domain
    /* solium-disable-next-line indentation */
    bytes32 constant private EIP712_DOMAIN_SEPARATOR_SCHEMA_HASH = keccak256(abi.encodePacked(
        EIP712_DOMAIN_STRING
    ));

    // EIP712 typeHash of Operation
    /* solium-disable-next-line indentation */
    bytes32 constant private EIP712_OPERATION_HASH = keccak256(abi.encodePacked(
        EIP712_OPERATION_STRING,
        EIP712_ACTION_STRING,
        EIP712_ASSET_AMOUNT_STRING
    ));

    // EIP712 typeHash of Action
    /* solium-disable-next-line indentation */
    bytes32 constant private EIP712_ACTION_HASH = keccak256(abi.encodePacked(
        EIP712_ACTION_STRING,
        EIP712_ASSET_AMOUNT_STRING
    ));

    // EIP712 typeHash of AssetAmount
    /* solium-disable-next-line indentation */
    bytes32 constant private EIP712_ASSET_AMOUNT_HASH = keccak256(abi.encodePacked(
        EIP712_ASSET_AMOUNT_STRING
    ));

    // ============ Structs ============

    struct Authorization {
        uint256 numActions;
        uint256 expiration;
        uint256 salt;
        address sender;
        bytes signature;
    }

    struct OperationQueryInput {
        bytes32 operationHash;
        address operationSigner;
    }

    // ============ Events ============

    event ContractStatusSet(
        bool operational
    );

    event LogOperationExecuted(
        bytes32 indexed operationHash,
        address indexed signer,
        address indexed sender
    );

    event LogOperationCanceled(
        bytes32 indexed operationHash,
        address indexed canceler
    );

    // ============ Immutable Storage ============

    // Hash of the EIP712 Domain Separator data
    bytes32 public EIP712_DOMAIN_HASH;

    // ============ Mutable Storage ============

     // true if this contract can process operationss
    bool public g_isOperational;

    // signer => final hash => was executed (or canceled)
    mapping (address => mapping (bytes32 => bool)) public g_invalidated;

    // ============ Constructor ============

    constructor (
        address soloMargin,
        uint256 chainId
    )
        public
        OnlySolo(soloMargin)
    {
        g_isOperational = true;

        /* solium-disable-next-line indentation */
        EIP712_DOMAIN_HASH = keccak256(abi.encode(
            EIP712_DOMAIN_SEPARATOR_SCHEMA_HASH,
            keccak256(bytes(EIP712_DOMAIN_NAME)),
            keccak256(bytes(EIP712_DOMAIN_VERSION)),
            chainId,
            address(this)
        ));
    }

    // ============ Admin Functions ============

     /**
     * The owner can shut down the exchange.
     */
    function shutDown()
        external
        onlyOwner
    {
        g_isOperational = false;
        emit ContractStatusSet(false);
    }

     /**
     * The owner can start back up the exchange.
     */
    function startUp()
        external
        onlyOwner
    {
        g_isOperational = true;
        emit ContractStatusSet(true);
    }

    // ============ Public Functions ============

    /**
     * Allows a signer to permanently cancel an operation on-chain.
     *
     * @param  operationHash  The EIP712 hash of the Operation message to cancel.
     */
    function cancel(
        bytes32 operationHash
    )
        external
    {
        g_invalidated[msg.sender][operationHash] = true;
        emit LogOperationCanceled(operationHash, msg.sender);
    }

    /**
     * Submits an operation to SoloMargin. Actions for accounts that the msg.sender does not control
     * must be authorized by a signed message. Each authorization can apply to multiple actions at
     * once which must occur in-order next to each other. An empty authorization must be supplied
     * explicitly for each group of actions that do not require a signed message.
     *
     * @param  accounts  The accounts to forward to SoloMargin.operate()
     * @param  actions   The actions to forward to SoloMargin.operate()
     * @param  auths     The signed authorizations for each group of actions
     *                   (or unsigned if msg.sender is already authorized)
     */
    function operate(
        Account.Info[] memory accounts,
        Actions.ActionArgs[] memory actions,
        Authorization[] memory auths
    )
        public
    {
        Require.that(
            g_isOperational,
            FILE,
            "Contract is not operational"
        );

        // cache the index of the first action for this auth
        uint256 actionStartIdx = 0;

        // loop over all auths
        for (uint256 authIdx = 0; authIdx < auths.length; authIdx++) {
            Authorization memory auth = auths[authIdx];

            // require that the message is not expired
            Require.that(
                auth.expiration == 0 || auth.expiration >= block.timestamp,
                FILE,
                "Signed operation is expired",
                authIdx
            );

            // require that the sender matches the authorization
            Require.that(
                auth.sender == address(0) || auth.sender == msg.sender,
                FILE,
                "Operation sender mismatch",
                authIdx
            );

            // get the signer of the auth (msg.sender if no signature)
            address signer = getSigner(
                accounts,
                actions,
                auth,
                actionStartIdx
            );

            // cache the index of the first action after this auth
            uint256 actionEndIdx = actionStartIdx.add(auth.numActions);

            // loop over all actions for which this auth applies
            for (uint256 actionIdx = actionStartIdx; actionIdx < actionEndIdx; actionIdx++) {
                // validate primary account
                Actions.ActionArgs memory action = actions[actionIdx];
                validateAccountOwner(accounts[action.accountId].owner, signer);

                // validate second account in the case of a transfer
                if (action.actionType == Actions.ActionType.Transfer) {
                    validateAccountOwner(accounts[action.otherAccountId].owner, signer);
                }
            }

            // update actionStartIdx
            actionStartIdx = actionEndIdx;
        }

        // require that all actions are signed or from msg.sender
        Require.that(
            actionStartIdx == actions.length,
            FILE,
            "Not all actions are signed"
        );

        // send the operation
        SOLO_MARGIN.operate(accounts, actions);
    }

    // ============ Getters ============

    /**
     * Returns a bool for each operation. True if the operation is invalid (from being canceled or
     * previously executed).
     */
    function getOperationsAreInvalid(
        OperationQueryInput[] memory operations
    )
        public
        view
        returns(bool[] memory)
    {
        uint256 numOperations = operations.length;
        bool[] memory output = new bool[](numOperations);

        for (uint256 i = 0; i < numOperations; i++) {
            OperationQueryInput memory operation = operations[i];
            output[i] = g_invalidated[operation.operationSigner][operation.operationHash];
        }
        return output;
    }

    // ============ Private Helper Functions ============

    /**
     * If the signature is empty, returns msg.sender.
     * If the signature exists, checks that the operation is still valid, invalidates it, and then
     * returns the signer of the authorization.
     */
    function getSigner(
        Account.Info[] memory accounts,
        Actions.ActionArgs[] memory actions,
        Authorization memory auth,
        uint256 startIdx
    )
        private
        returns (address)
    {
        // consider msg.sender to be the signer in the case of empty signature
        if (auth.signature.length == 0) {
            return msg.sender;
        }

        // get the hash of the operation
        bytes32 operationHash = getOperationHash(
            accounts,
            actions,
            auth,
            startIdx
        );

        // get the signer
        address signer = TypedSignature.recover(operationHash, auth.signature);

        // require that this message is still valid
        Require.that(
            !g_invalidated[signer][operationHash],
            FILE,
            "Hash already used or canceled",
            operationHash
        );

        // consider this operationHash to be used (and therefore no longer valid)
        g_invalidated[signer][operationHash] = true;
        emit LogOperationExecuted(operationHash, signer, msg.sender);

        return signer;
    }

    /**
     * Validates that either the signer or the msg.sender are the accountOwner (or that either are
     * localOperators of the accountOwner).
     */
    function validateAccountOwner(
        address accountOwner,
        address signer
    )
        private
        view
    {
        bool valid =
            msg.sender == accountOwner
            || signer == accountOwner
            || SOLO_MARGIN.getIsLocalOperator(accountOwner, msg.sender)
            || SOLO_MARGIN.getIsLocalOperator(accountOwner, signer);

        Require.that(
            valid,
            FILE,
            "Invalid signer",
            signer
        );
    }

    /**
     * Returns the EIP712 hash of an Operation message.
     */
    function getOperationHash(
        Account.Info[] memory accounts,
        Actions.ActionArgs[] memory actions,
        Authorization memory auth,
        uint256 startIdx
    )
        private
        view
        returns (bytes32)
    {
        // get the bytes32 hash of each action, then packed together
        bytes32 actionsEncoding = getActionsEncoding(
            accounts,
            actions,
            auth,
            startIdx
        );

        // compute the EIP712 hashStruct of an Operation struct
        /* solium-disable-next-line indentation */
        bytes32 structHash = keccak256(abi.encode(
            EIP712_OPERATION_HASH,
            actionsEncoding,
            auth.expiration,
            auth.salt,
            auth.sender
        ));

        // compute eip712 compliant hash
        /* solium-disable-next-line indentation */
        return keccak256(abi.encodePacked(
            EIP191_HEADER,
            EIP712_DOMAIN_HASH,
            structHash
        ));
    }

    /**
     * Returns the EIP712 encodeData of an Action struct array.
     */
    function getActionsEncoding(
        Account.Info[] memory accounts,
        Actions.ActionArgs[] memory actions,
        Authorization memory auth,
        uint256 startIdx
    )
        private
        pure
        returns (bytes32)
    {
        // store hash of each action
        bytes32[] memory actionsBytes = new bytes32[](auth.numActions);

        // for each action that corresponds to the auth
        for (uint256 i = 0; i < auth.numActions; i++) {
            Actions.ActionArgs memory action = actions[startIdx + i];

            // if action type has no second account, assume null account
            Account.Info memory otherAccount =
                (Actions.getAccountLayout(action.actionType) == Actions.AccountLayout.OnePrimary)
                ? Account.Info({ owner: address(0), number: 0 })
                : accounts[action.otherAccountId];

            // compute the individual hash for the action
            /* solium-disable-next-line indentation */
            actionsBytes[i] = getActionHash(
                action,
                accounts[action.accountId],
                otherAccount
            );
        }

        return keccak256(abi.encodePacked(actionsBytes));
    }

    /**
     * Returns the EIP712 hashStruct of an Action struct.
     */
    function getActionHash(
        Actions.ActionArgs memory action,
        Account.Info memory primaryAccount,
        Account.Info memory secondaryAccount
    )
        private
        pure
        returns (bytes32)
    {
        /* solium-disable-next-line indentation */
        return keccak256(abi.encode(
            EIP712_ACTION_HASH,
            action.actionType,
            primaryAccount.owner,
            primaryAccount.number,
            getAssetAmountHash(action.amount),
            action.primaryMarketId,
            action.secondaryMarketId,
            action.otherAddress,
            secondaryAccount.owner,
            secondaryAccount.number,
            keccak256(action.data)
        ));
    }

    /**
     * Returns the EIP712 hashStruct of an AssetAmount struct.
     */
    function getAssetAmountHash(
        Types.AssetAmount memory amount
    )
        private
        pure
        returns (bytes32)
    {
        /* solium-disable-next-line indentation */
        return keccak256(abi.encode(
            EIP712_ASSET_AMOUNT_HASH,
            amount.sign,
            amount.denomination,
            amount.ref,
            amount.value
        ));
    }
}
