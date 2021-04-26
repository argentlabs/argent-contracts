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
pragma solidity ^0.8.3;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "./common/Utils.sol";
import "./common/BaseModule.sol";
import "./common/SimpleOracle.sol";
import "../infrastructure/storage/IGuardianStorage.sol";

/**
 * @title RelayerManager
 * @notice Abstract Module to execute transactions signed by ETH-less accounts and sent by a relayer.
 * @author Julien Niset <julien@argent.xyz>, Olivier VDB <olivier@argent.xyz>
 */
abstract contract RelayerManager is BaseModule, SimpleOracle {

    uint256 constant internal BLOCKBOUND = 10000;

    mapping (address => RelayerConfig) internal relayer;

    struct RelayerConfig {
        uint256 nonce;
        mapping (bytes32 => bool) executedTx;
    }

    // Used to avoid stack too deep error
    struct StackExtension {
        uint256 requiredSignatures;
        OwnerSignature ownerSignatureRequirement;
        bytes32 signHash;
        bool success;
        bytes returnData;
    }

    event TransactionExecuted(address indexed wallet, bool indexed success, bytes returnData, bytes32 signedHash);
    event Refund(address indexed wallet, address indexed refundAddress, address refundToken, uint256 refundAmount);

    // *************** Constructor ************************ //

    constructor(address _uniswapRouter) SimpleOracle(_uniswapRouter) {

    }

    /* ***************** External methods ************************* */

    /**
    * @notice Gets the number of valid signatures that must be provided to execute a
    * specific relayed transaction.
    * @param _wallet The target wallet.
    * @param _data The data of the relayed transaction.
    * @return The number of required signatures and the wallet owner signature requirement.
    */
    function getRequiredSignatures(address _wallet, bytes calldata _data) public view virtual returns (uint256, OwnerSignature);

    /**
    * @notice Executes a relayed transaction.
    * @param _wallet The target wallet.
    * @param _data The data for the relayed transaction
    * @param _nonce The nonce used to prevent replay attacks.
    * @param _signatures The signatures as a concatenated byte array.
    * @param _gasPrice The max gas price (in token) to use for the gas refund.
    * @param _gasLimit The max gas limit to use for the gas refund.
    * @param _refundToken The token to use for the gas refund.
    * @param _refundAddress The address refunded to prevent front-running.
    */
    function execute(
        address _wallet,
        bytes calldata _data,
        uint256 _nonce,
        bytes calldata _signatures,
        uint256 _gasPrice,
        uint256 _gasLimit,
        address _refundToken,
        address _refundAddress
    )
        external
        returns (bool)
    {
        // initial gas = 21k + non_zero_bytes * 16 + zero_bytes * 4
        //            ~= 21k + calldata.length * [1/3 * 16 + 2/3 * 4]
        uint256 startGas = gasleft() + 21000 + msg.data.length * 8;
        require(startGas >= _gasLimit, "RM: not enough gas provided");
        require(verifyData(_wallet, _data), "RM: Target of _data != _wallet");

        require(!_isLocked(_wallet) || _gasPrice == 0, "RM: Locked wallet refund");

        StackExtension memory stack;
        (stack.requiredSignatures, stack.ownerSignatureRequirement) = getRequiredSignatures(_wallet, _data);

        require(stack.requiredSignatures > 0 || stack.ownerSignatureRequirement == OwnerSignature.Anyone, "RM: Wrong signature requirement");
        require(stack.requiredSignatures * 65 == _signatures.length, "RM: Wrong number of signatures");
        stack.signHash = getSignHash(
            address(this),
            0,
            _data,
            _nonce,
            _gasPrice,
            _gasLimit,
            _refundToken,
            _refundAddress);
        require(checkAndUpdateUniqueness(
            _wallet,
            _nonce,
            stack.signHash,
            stack.requiredSignatures,
            stack.ownerSignatureRequirement), "RM: Duplicate request");

        if (stack.ownerSignatureRequirement == OwnerSignature.Session) {
            require(validateSession(_wallet, stack.signHash, _signatures), "RM: Invalid session");
        } else {
            require(validateSignatures(_wallet, stack.signHash, _signatures, stack.ownerSignatureRequirement), "RM: Invalid signatures");
        }
        (stack.success, stack.returnData) = address(this).call(_data);
        refund(
            _wallet,
            startGas,
            _gasPrice,
            _gasLimit,
            _refundToken,
            _refundAddress,
            stack.requiredSignatures,
            stack.ownerSignatureRequirement);
        emit TransactionExecuted(_wallet, stack.success, stack.returnData, stack.signHash);
        return stack.success;
    }

    /**
    * @notice Gets the current nonce for a wallet.
    * @param _wallet The target wallet.
    */
    function getNonce(address _wallet) external view returns (uint256 nonce) {
        return relayer[_wallet].nonce;
    }

    /**
    * @notice Checks if a transaction identified by its sign hash has already been executed.
    * @param _wallet The target wallet.
    * @param _signHash The sign hash of the transaction.
    */
    function isExecutedTx(address _wallet, bytes32 _signHash) external view returns (bool executed) {
        return relayer[_wallet].executedTx[_signHash];
    }

    /**
    * @notice Gets the last stored session for a wallet.
    * @param _wallet The target wallet.
    */
    function getSession(address _wallet) external view returns (address key, uint64 expires) {
        return (sessions[_wallet].key, sessions[_wallet].expires);
    }

    /* ***************** Internal & Private methods ************************* */

    /**
    * @notice Generates the signed hash of a relayed transaction according to ERC 1077.
    * @param _from The starting address for the relayed transaction (should be the relayer module)
    * @param _value The value for the relayed transaction.
    * @param _data The data for the relayed transaction which includes the wallet address.
    * @param _nonce The nonce used to prevent replay attacks.
    * @param _gasPrice The max gas price (in token) to use for the gas refund.
    * @param _gasLimit The max gas limit to use for the gas refund.
    * @param _refundToken The token to use for the gas refund.
    * @param _refundAddress The address refunded to prevent front-running.
    */
    function getSignHash(
        address _from,
        uint256 _value,
        bytes memory _data,
        uint256 _nonce,
        uint256 _gasPrice,
        uint256 _gasLimit,
        address _refundToken,
        address _refundAddress
    )
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(
                    bytes1(0x19),
                    bytes1(0),
                    _from,
                    _value,
                    _data,
                    block.chainid,
                    _nonce,
                    _gasPrice,
                    _gasLimit,
                    _refundToken,
                    _refundAddress))
        ));
    }

    /**
    * @notice Checks if the relayed transaction is unique. If yes the state is updated.
    * For actions requiring 1 signature by the owner or a session key we use the incremental nonce.
    * For all other actions we check/store the signHash in a mapping.
    * @param _wallet The target wallet.
    * @param _nonce The nonce.
    * @param _signHash The signed hash of the transaction.
    * @param requiredSignatures The number of signatures required.
    * @param ownerSignatureRequirement The wallet owner signature requirement.
    * @return true if the transaction is unique.
    */
    function checkAndUpdateUniqueness(
        address _wallet,
        uint256 _nonce,
        bytes32 _signHash,
        uint256 requiredSignatures,
        OwnerSignature ownerSignatureRequirement
    )
        internal
        returns (bool)
    {
        if (requiredSignatures == 1 &&
            (ownerSignatureRequirement == OwnerSignature.Required || ownerSignatureRequirement == OwnerSignature.Session)) {
            // use the incremental nonce
            if (_nonce <= relayer[_wallet].nonce) {
                return false;
            }
            uint256 nonceBlock = (_nonce & 0xffffffffffffffffffffffffffffffff00000000000000000000000000000000) >> 128;
            if (nonceBlock > block.number + BLOCKBOUND) {
                return false;
            }
            relayer[_wallet].nonce = _nonce;
            return true;
        } else {
            // use the txHash map
            if (relayer[_wallet].executedTx[_signHash] == true) {
                return false;
            }
            relayer[_wallet].executedTx[_signHash] = true;
            return true;
        }
    }

    /**
    * @notice Validates the signatures provided with a relayed transaction.
    * @param _wallet The target wallet.
    * @param _signHash The signed hash representing the relayed transaction.
    * @param _signatures The signatures as a concatenated bytes array.
    * @param _option An OwnerSignature enum indicating whether the owner is required, optional or disallowed.
    * @return A boolean indicating whether the signatures are valid.
    */
    function validateSignatures(address _wallet, bytes32 _signHash, bytes memory _signatures, OwnerSignature _option) internal view returns (bool)
    {
        if (_signatures.length == 0) {
            return true;
        }
        address lastSigner = address(0);
        address[] memory guardians;
        if (_option != OwnerSignature.Required || _signatures.length > 65) {
            guardians = guardianStorage.getGuardians(_wallet); // guardians are only read if they may be needed
        }
        bool isGuardian;

        for (uint256 i = 0; i < _signatures.length / 65; i++) {
            address signer = Utils.recoverSigner(_signHash, _signatures, i);

            if (i == 0) {
                if (_option == OwnerSignature.Required) {
                    // First signer must be owner
                    if (_isOwner(_wallet, signer)) {
                        continue;
                    }
                    return false;
                } else if (_option == OwnerSignature.Optional) {
                    // First signer can be owner
                    if (_isOwner(_wallet, signer)) {
                        continue;
                    }
                }
            }
            if (signer <= lastSigner) {
                return false; // Signers must be different
            }
            lastSigner = signer;
            (isGuardian, guardians) = Utils.isGuardianOrGuardianSigner(guardians, signer);
            if (!isGuardian) {
                return false;
            }
        }
        return true;
    }

    /**
    * @notice Validates the signature provided when a session key was used.
    * @param _wallet The target wallet.
    * @param _signHash The signed hash representing the relayed transaction.
    * @param _signatures The signatures as a concatenated bytes array.
    * @return A boolean indicating whether the signature is valid.
    */
    function validateSession(address _wallet, bytes32 _signHash, bytes calldata _signatures) internal view returns (bool) { 
        Session memory session = sessions[_wallet];
        address signer = Utils.recoverSigner(_signHash, _signatures, 0);
        return (signer == session.key && session.expires >= block.timestamp);
    }

    /**
    * @notice Refunds the gas used to the Relayer.
    * @param _wallet The target wallet.
    * @param _startGas The gas provided at the start of the execution.
    * @param _gasPrice The max gas price (in token) for the refund.
    * @param _gasLimit The max gas limit for the refund.
    * @param _refundToken The token to use for the gas refund.
    * @param _refundAddress The address refunded to prevent front-running.
    * @param _requiredSignatures The number of signatures required.
    * @param _option An OwnerSignature enum indicating the signature requirement.
    */
    function refund(
        address _wallet,
        uint _startGas,
        uint _gasPrice,
        uint _gasLimit,
        address _refundToken,
        address _refundAddress,
        uint256 _requiredSignatures,
        OwnerSignature _option
    )
        internal
    {
        // Only refund when the owner is one of the signers or a session key was used
        if (_gasPrice > 0 && (_option == OwnerSignature.Required || _option == OwnerSignature.Session)) {
            address refundAddress = _refundAddress == address(0) ? msg.sender : _refundAddress;
            if (_requiredSignatures == 1 && _option == OwnerSignature.Required) {
                    // refundAddress must be whitelisted/authorised
                    if (!authoriser.isAuthorised(_wallet, refundAddress, address(0), EMPTY_BYTES)) {
                        uint whitelistAfter = userWhitelist.getWhitelist(_wallet, refundAddress);
                        require(whitelistAfter > 0 && whitelistAfter < block.timestamp, "RM: refund not authorised");
                    }
            }
            uint256 refundAmount;
            if (_refundToken == ETH_TOKEN) {
                // 23k as an upper bound to cover the rest of refund logic
                uint256 gasConsumed = _startGas - gasleft() + 23000;
                refundAmount = Math.min(gasConsumed, _gasLimit) * (Math.min(_gasPrice, tx.gasprice));
                invokeWallet(_wallet, refundAddress, refundAmount, EMPTY_BYTES);
            } else {
                // 37.5k as an upper bound to cover the rest of refund logic
                uint256 gasConsumed = _startGas - gasleft() + 37500;
                uint256 tokenGasPrice = inToken(_refundToken, tx.gasprice);
                refundAmount = Math.min(gasConsumed, _gasLimit) * (Math.min(_gasPrice, tokenGasPrice));
                bytes memory methodData = abi.encodeWithSelector(ERC20.transfer.selector, refundAddress, refundAmount);
                bytes memory transferSuccessBytes = invokeWallet(_wallet, _refundToken, 0, methodData);
                // Check token refund is successful, when `transfer` returns a success bool result
                if (transferSuccessBytes.length > 0) {
                    require(abi.decode(transferSuccessBytes, (bool)), "RM: Refund transfer failed");
                }
            }
            emit Refund(_wallet, refundAddress, _refundToken, refundAmount);    
        }
    }

    /**
    * @notice Checks that the wallet address provided as the first parameter of _data matches _wallet
    * @return false if the addresses are different.
    */
    function verifyData(address _wallet, bytes calldata _data) internal pure returns (bool) {
        require(_data.length >= 36, "RM: Invalid dataWallet");
        address dataWallet = abi.decode(_data[4:], (address));
        return dataWallet == _wallet;
    }
}