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

pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/BaseTransfer.sol";
import "../../lib/utils/SafeMath.sol";
import "../utils/GuardianUtils.sol";

/**
 * @title ApprovedTransfer
 * @dev Module to transfer tokens (ETH or ERC20) with the approval of guardians.
 * @author Julien Niset - <julien@argent.im>
 */
contract ApprovedTransfer is BaseModule, RelayerModule, BaseTransfer {

    bytes32 constant NAME = "ApprovedTransfer";

    constructor(ModuleRegistry _registry, GuardianStorage _guardianStorage) BaseModule(_registry, _guardianStorage, NAME) public {

    }

    /**
    * @dev transfers tokens (ETH or ERC20) from a wallet.
    * @param _wallet The target wallet.
    * @param _token The address of the token to transfer.
    * @param _to The destination address
    * @param _amount The amoutnof token to transfer
    * @param _data  The data for the transaction (only for ETH transfers)
    */
    function transferToken(
        BaseWallet _wallet,
        address _token,
        address _to,
        uint256 _amount,
        bytes calldata _data
    )
        external
        onlyExecute
        onlyWhenUnlocked(_wallet)
    {
        doTransfer(_wallet, _token, _to, _amount, _data);
    }

    /**
    * @dev call a contract.
    * @param _wallet The target wallet.
    * @param _contract The address of the contract.
    * @param _value The amount of ETH to transfer as part of call
    * @param _data The encoded method data
    */
    function callContract(
        BaseWallet _wallet,
        address _contract,
        uint256 _value,
        bytes calldata _data
    )
        external
        onlyExecute
        onlyWhenUnlocked(_wallet)
    {
        require(!_wallet.authorised(_contract) && _contract != address(_wallet), "AT: Forbidden contract");
        doCallContract(_wallet, _contract, _value, _data);
    }

    /**
    * @dev lets the owner do an ERC20 approve followed by a call to a contract.
    * We assume that the contract will pull the tokens and does not require ETH.
    * @param _wallet The target wallet.
    * @param _token The token to approve.
    * @param _contract The address of the contract.
    * @param _amount The amount of ERC20 tokens to approve.
    * @param _data The encoded method data
    */
    function approveTokenAndCallContract(
        BaseWallet _wallet,
        address _token,
        address _contract,
        uint256 _amount,
        bytes calldata _data
    )
        external
        onlyExecute
        onlyWhenUnlocked(_wallet)
    {
        require(!_wallet.authorised(_contract) && _contract != address(_wallet), "AT: Forbidden contract");
        doApproveToken(_wallet, _token, _contract, _amount);
        doCallContract(_wallet, _contract, 0, _data);
    }

    // *************** Implementation of RelayerModule methods ********************* //

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory /* _data */,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        return validateSignatures(_wallet, _signHash, _signatures, OwnerSignature.Required);
    }

    function getRequiredSignatures(BaseWallet _wallet, bytes memory /* _data */) internal view returns (uint256) {
        // owner  + [n/2] guardians
        return  1 + SafeMath.ceil(guardianStorage.guardianCount(_wallet), 2);
    }
}