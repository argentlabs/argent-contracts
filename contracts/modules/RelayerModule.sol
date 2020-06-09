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
pragma solidity ^0.6.10;

import "./common/Utils.sol";
import "./common/BaseModule.sol";
import "./common/LimitManager.sol";
import "./common/GuardianUtils.sol";

/**
 * @title RelayerModule
 * @dev Module to execute transactions signed by eth-less accounts and sent by a relayer.
 * @author Julien Niset <julien@argent.xyz>, Olivier VDB <olivier@argent.xyz>
 */
contract RelayerModule is BaseModule, LimitManager {

    bytes32 constant NAME = "RelayerModule";

    uint256 constant internal BLOCKBOUND = 10000;

    mapping (address => RelayerConfig) public relayer;

    struct RelayerConfig {
        uint256 nonce;
        mapping (bytes32 => bool) executedTx;
    }

    event TransactionExecuted(address indexed wallet, bool indexed success, bytes returnData, bytes32 signedHash);

    /* ***************** External methods ************************* */

    constructor(
        IModuleRegistry _registry,
        IGuardianStorage _guardianStorage,
        ILimitStorage _storageLimit
    )
        BaseModule(_registry, _guardianStorage, NAME)
        LimitManager(_storageLimit, 0)
        public
    {

    }

    /**
    * @dev Executes a relayed transaction.
    * @param _module The target module.
    * @param _data The data for the relayed transaction
    * @param _nonce The nonce used to prevent replay attacks.
    * @param _signatures The signatures as a concatenated byte array.
    * @param _gasPrice The gas price to use for the gas refund.
    * @param _gasLimit The gas limit to use for the gas refund.
    */
    function execute(
        address _module,
        bytes calldata _data,
        uint256 _nonce,
        bytes calldata _signatures,
        uint256 _gasPrice,
        uint256 _gasLimit
    )
        external
        returns (bool)
    {
        uint startGas = gasleft();
        address wallet = getWalletFromData(_data);
        require(isModule(wallet, _module), "RM: module not authorised");
        bytes32 signHash = getSignHash(address(this), _module, 0, _data, _nonce, _gasPrice, _gasLimit);
        (uint256 requiredSignatures, OwnerSignature ownerSignatureRequirement) = IModule(_module).getRequiredSignatures(wallet, _data);
        require(requiredSignatures > 0 || ownerSignatureRequirement == OwnerSignature.Anyone, "RM: Wrong number of required signatures");
        require(checkAndUpdateUniqueness(wallet, _nonce, signHash, requiredSignatures, ownerSignatureRequirement), "RM: Duplicate request");
        require(requiredSignatures * 65 == _signatures.length, "RM: Wrong number of signatures");
        require(validateSignatures(wallet, signHash, _signatures, ownerSignatureRequirement), "RM: Invalid signatures");
        // solium-disable-next-line security/no-low-level-calls
        (bool success, bytes memory returnData) = _module.call(_data);
        refund(
            wallet,
            startGas - gasleft(),
            _gasPrice,
            _gasLimit,
            requiredSignatures,
            ownerSignatureRequirement,
            msg.sender);
        emit TransactionExecuted(wallet, success, returnData, signHash);
        return success;
    }

    /**
    * @dev Gets the current nonce for a wallet.
    * @param _wallet The target wallet.
    */
    function getNonce(address _wallet) external view returns (uint256 nonce) {
        return relayer[_wallet].nonce;
    }

    /**
    * @dev Implementation of the getRequiredSignatures from the IModule interface.
    * The method should not be called and will always revert.
    * @param _wallet The target wallet.
    * @param _data The data of the relayed transaction.
    * @return always reverts.
    */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external virtual override view returns (uint256, OwnerSignature) {
        revert("RM: disabled method");
    }

    /* ***************** Internal & Private methods ************************* */

    /**
    * @dev Generates the signed hash of a relayed transaction according to ERC 1077.
    * @param _from The starting address for the relayed transaction (should be the module)
    * @param _to The destination address for the relayed transaction (should be the wallet)
    * @param _value The value for the relayed transaction
    * @param _data The data for the relayed transaction
    * @param _nonce The nonce used to prevent replay attacks.
    * @param _gasPrice The gas price to use for the gas refund.
    * @param _gasLimit The gas limit to use for the gas refund.
    */
    function getSignHash(
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data,
        uint256 _nonce,
        uint256 _gasPrice,
        uint256 _gasLimit
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(byte(0x19), byte(0), _from, _to, _value, _data, _nonce, _gasPrice, _gasLimit))
        ));
    }

    /**
    * @dev Checks if the relayed transaction is unique. If yes the state is updated.
    * For actions requiring 1 signature by the owner we use the incremental nonce.
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
        if (requiredSignatures == 1 && ownerSignatureRequirement == OwnerSignature.Required) {
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
    * @dev Validates the signatures provided with a relayed transaction.
    * The method MUST throw if one or more signatures are not valid.
    * @param _wallet The target wallet.
    * @param _signHash The signed hash representing the relayed transaction.
    * @param _signatures The signatures as a concatenated byte array.
    * @param _option An enum indicating whether the owner is required, optional or disallowed.
    * @return A boolean indicating whether the signatures are valid.
    */
    function validateSignatures(
        address _wallet,
        bytes32 _signHash,
        bytes memory _signatures,
        OwnerSignature _option
    )
        internal
        view
        returns (bool)
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

        for (uint8 i = 0; i < _signatures.length / 65; i++) {
            address signer = Utils.recoverSigner(_signHash, _signatures, i);

            if (i == 0) {
                if (_option == OwnerSignature.Required) {
                    // First signer must be owner
                    if (isOwner(_wallet, signer)) {
                        continue;
                    }
                    return false;
                } else if (_option == OwnerSignature.Optional) {
                    // First signer can be owner
                    if (isOwner(_wallet, signer)) {
                        continue;
                    }
                }
            }
            if (signer <= lastSigner) {
                return false; // Signers must be different
            }
            lastSigner = signer;
            (isGuardian, guardians) = GuardianUtils.isGuardian(guardians, signer);
            if (!isGuardian) {
                return false;
            }
        }
        return true;
    }



    /**
    * @dev Refunds the gas used to the Relayer.
    * For security reasons the default behavior is to not refund calls with 0 or 1 signatures unless the owner is signing.
    * @param _wallet The target wallet.
    * @param _gasUsed The gas used.
    * @param _gasPrice The gas price for the refund.
    * @param _gasLimit The gas limit for the refund.
    * @param _signatures The number of signatures used in the call.
    * @param _ownerSignatureRequirement The owner signature requirement.
    * @param _relayer The address of the Relayer.
    */
    function refund(
        address _wallet,
        uint _gasUsed,
        uint _gasPrice,
        uint _gasLimit,
        uint _signatures,
        OwnerSignature _ownerSignatureRequirement,
        address _relayer
    )
        internal
    {
        // 21000 (transaction) + 7620 (execution of refund) + 7324 (execution of updateDailySpent) + 672 to log the event + _gasUsed
        uint256 amount = 36616 + _gasUsed;
        if (_gasPrice > 0 && _signatures > 0 && _ownerSignatureRequirement == OwnerSignature.Required && amount <= _gasLimit) {
            if (_gasPrice > tx.gasprice) {
                amount = amount * tx.gasprice;
            } else {
                amount = amount * _gasPrice;
            }
            checkAndUpdateDailySpent(_wallet, amount);
            invokeWallet(_wallet, _relayer, amount, EMPTY_BYTES);
        }
    }

   /**
    * @dev Gets the address of the target wallet as the first parameter of an encoded function call.
    * @param _data The data.
    * @return _wallet the address of the target wallet.
    */
    function getWalletFromData(bytes memory _data) private pure returns (address _wallet) {
        require(_data.length >= 36, "RM: Invalid data");
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            //_data = {length:32}{sig:4}{_wallet:32}{...}
            _wallet := mload(add(_data, 0x24))
        }
    }
}