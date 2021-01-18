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
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "../base/Utils.sol";
import "../base/BaseModule.sol";
import "../base/Configuration.sol";
import "./IRelayerManager.sol";
import "./IGuardianManager.sol";

/**
 * @title Relayer
 * @notice Contract to execute transactions signed by ETH-less accounts and sent by a relayer back end.
 * @author Julien Niset <julien@argent.xyz>, Olivier VDB <olivier@argent.xyz>
 */
contract RelayerManager is IRelayerManager, BaseModule {

    uint256 constant internal BLOCKBOUND = 10000;
    using SafeMath for uint256;

    // Used to avoid stack too deep error
    struct StackExtension {
        uint256 requiredSignatures;
        OwnerSignature ownerSignatureRequirement;
        bytes32 signHash;
        bool success;
        bytes returnData;
    }

    /* ***************** External methods ************************* */
    /**
    * @inheritdoc IRelayerManager
    */
    function getNonce() external override pure returns (uint256 nonce) {
        return nonce;
    }

    /**
    * @inheritdoc IRelayerManager
    */
    function isExecutedTx(bytes32 _signHash) external override view returns (bool executed) {
        return executedTx[_signHash];
    }

    /**
    * @inheritdoc IRelayerManager
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
        external override
        returns (bool)
    {
        uint startGas = gasleft();
        require(startGas >= _gasLimit, "RM: not enough gas provided");
        // require(verifyData(_data), "RM: Target of _data != _wallet");
        StackExtension memory stack;
        (stack.requiredSignatures, stack.ownerSignatureRequirement) = getRequiredSignatures();
        require(stack.requiredSignatures > 0 || stack.ownerSignatureRequirement == OwnerSignature.Anyone, "RM: Wrong signature requirement");
        require(stack.requiredSignatures * 65 == _signatures.length, "RM: Wrong number of signatures");
        stack.signHash = getSignHash(
            address(this),
            address(this),
            0,
            _data,
            _nonce,
            _gasPrice,
            _gasLimit,
            _refundToken,
            _refundAddress);
        require(checkAndUpdateUniqueness(
            _nonce,
            stack.signHash,
            stack.requiredSignatures,
            stack.ownerSignatureRequirement), "RM: Duplicate request");
        require(validateSignatures(stack.signHash, _signatures, stack.ownerSignatureRequirement), "RM: Invalid signatures");

        // Call wallet (itself) with the data
        (stack.success, stack.returnData) = address(this).call(_data);
        if (!stack.success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        // only refund when approved by owner and positive gas price
        if (_gasPrice > 0 && stack.ownerSignatureRequirement == OwnerSignature.Required) {
            refund(
                startGas,
                _gasPrice,
                _gasLimit,
                _refundToken,
                _refundAddress,
                stack.requiredSignatures);
        }
        emit TransactionExecuted(address(this), stack.success, stack.returnData, stack.signHash);
        return stack.success;
    }

    /* ***************** Internal & Private methods ************************* */

    /**
    * @notice Generates the signed hash of a relayed transaction according to ERC 1077.
    * @param _from The starting address for the relayed transaction (should be the relayer module)
    * @param _to The destination address for the relayed transaction (should be the target module)
    * @param _value The value for the relayed transaction.
    * @param _data The data for the relayed transaction which includes the wallet address.
    * @param _nonce The nonce used to prevent replay attacks.
    * @param _gasPrice The gas price to use for the gas refund.
    * @param _gasLimit The gas limit to use for the gas refund.
    * @param _refundToken The token to use for the gas refund.
    * @param _refundAddress The address refunded to prevent front-running.
    */
    function getSignHash(
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data,
        uint256 _nonce,
        uint256 _gasPrice,
        uint256 _gasLimit,
        address _refundToken,
        address _refundAddress
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(
                    byte(0x19),
                    byte(0),
                    _from,
                    _to,
                    _value,
                    _data,
                    getChainId(),
                    _nonce,
                    _gasPrice,
                    _gasLimit,
                    _refundToken,
                    _refundAddress))
        ));
    }

    /**
    * @notice Checks that the wallet address provided as the first parameter of _data matches _wallet
    * @return false if the addresses are different.
    */
    function verifyData(bytes calldata _data) internal view returns (bool) {
        require(_data.length >= 36, "RM: Invalid dataWallet");
        address dataWallet = abi.decode(_data[4:], (address));
        return dataWallet == address(this);
    }

    /**
    * @notice Checks if the relayed transaction is unique. If yes the state is updated.
    * For actions requiring 1 signature by the owner we use the incremental nonce.
    * For all other actions we check/store the signHash in a mapping.
    * @param _nonce The nonce.
    * @param _signHash The signed hash of the transaction.
    * @param requiredSignatures The number of signatures required.
    * @param ownerSignatureRequirement The wallet owner signature requirement.
    * @return true if the transaction is unique.
    */
    function checkAndUpdateUniqueness(
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
            if (_nonce <= nonce) {
                return false;
            }
            uint256 nonceBlock = (_nonce & 0xffffffffffffffffffffffffffffffff00000000000000000000000000000000) >> 128;
            if (nonceBlock > block.number + BLOCKBOUND) {
                return false;
            }
            nonce = _nonce;
            return true;
        } else {
            // use the txHash map
            if (executedTx[_signHash] == true) {
                return false;
            }
            executedTx[_signHash] = true;
            return true;
        }
    }

    /**
    * @notice Validates the signatures provided with a relayed transaction.
    * The method MUST throw if one or more signatures are not valid.
    * @param _signHash The signed hash representing the relayed transaction.
    * @param _signatures The signatures as a concatenated byte array.
    * @param _option An enum indicating whether the owner is required, optional or disallowed.
    * @return A boolean indicating whether the signatures are valid.
    */
    function validateSignatures(
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

        for (uint256 i = 0; i < _signatures.length / 65; i++) {
            address signer = Utils.recoverSigner(_signHash, _signatures, i);

            if (i == 0) {
                if (_option == OwnerSignature.Required) {
                    // First signer must be owner
                    if (signer == owner) {
                        continue;
                    }
                    return false;
                } else if (_option == OwnerSignature.Optional) {
                    // First signer can be owner
                    if (signer == owner) {
                        continue;
                    }
                }
            }
            if (signer <= lastSigner) {
                return false; // Signers must be different
            }
            lastSigner = signer;
            bool isGuardian = IGuardianManager(address(this)).isGuardianOrGuardianSigner(signer);
            if (!isGuardian) {
                return false;
            }
        }
        return true;
    }

    /**
    * @notice Refunds the gas used to the Relayer.
    * @param _startGas The gas provided at the start of the execution.
    * @param _gasPrice The gas price for the refund.
    * @param _gasLimit The gas limit for the refund.
    * @param _refundToken The token to use for the gas refund.
    * @param _refundAddress The address refunded to prevent front-running.
    * @param _requiredSignatures The number of signatures required.
    */
    function refund(
        uint _startGas,
        uint _gasPrice,
        uint _gasLimit,
        address _refundToken,
        address payable _refundAddress,
        uint256 _requiredSignatures
    )
        internal
    {
        address payable refundAddress = _refundAddress == address(0) ? msg.sender : _refundAddress;
        uint256 refundAmount;
        // skip daily limit when approved by guardians (and signed by owner)
        if (_requiredSignatures > 1) {
            uint256 gasConsumed = _startGas.sub(gasleft()).add(30000);
            refundAmount = Utils.min(gasConsumed, _gasLimit).mul(_gasPrice);
        } else {
            uint256 gasConsumed = _startGas.sub(gasleft()).add(40000);
            refundAmount = Utils.min(gasConsumed, _gasLimit).mul(_gasPrice);
            uint256 ethAmount = (_refundToken == ETH_TOKEN) ? refundAmount : getEtherValue(refundAmount, _refundToken);
            // TODO require(LimitUtils.checkAndUpdateDailySpent(limitStorage, versionManager, _wallet, ethAmount), "RM: refund is above daily limit");
        }
        // refund in ETH or ERC20
        if (_refundToken == ETH_TOKEN) {
            refundAddress.transfer(refundAmount);
        } else {
		    ERC20(_refundToken).transfer(refundAddress, refundAmount);
            // TODO Check token refund is successful, when `transfer` returns a success bool result
            // if (transferSuccessBytes.length > 0) {
            //     require(abi.decode(transferSuccessBytes, (bool)), "RM: Refund transfer failed");
            // }
        }
        emit Refund(address(this), refundAddress, _refundToken, refundAmount);
    }

   /**
    * @notice Returns the current chainId
    * @return chainId the chainId
    */
    function getChainId() private pure returns (uint256 chainId) {
        // solhint-disable-next-line no-inline-assembly
        assembly { chainId := chainid() }
    }

    function getEtherValue(uint256 _amount, address _token) internal view returns (uint256) {
        ITokenPriceRegistry tokenPriceRegistry = Configuration(registry).tokenPriceRegistry();

        uint256 price = tokenPriceRegistry.getTokenPrice(_token);
        uint256 etherValue = price.mul(_amount).div(10**18);
        return etherValue;
    }

    // Todo incorporate the remaining required signatures implementations 
    // below only caters for TransferManager signatures requirement
    function getRequiredSignatures() public view returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}