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
import "./common/RelayerManager.sol";
import "./dapp/IAuthoriser.sol";
import "../infrastructure/storage/IGuardianStorage.sol";
import "../infrastructure/storage/ITransferStorage.sol";
import "../../lib/other/ERC20.sol";

/**
 * @title ApprovedTransfer
 * @notice Feature to transfer tokens (ETH or ERC20) or call third-party contracts with the approval of guardians.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TransactionManager is RelayerManager {

    bytes32 constant NAME = "TransactionManager";

    bytes4 constant internal TRANSFER_SESSION_PREFIX = bytes4(keccak256("transferTokenWithSession(address,address,uint64,address,address,uint256,bytes)"));
    bytes4 constant internal TRANSFER_WHITELIST_PREFIX = bytes4(keccak256("transferTokenWithWithelist(address,address,address,uint256,bytes)"));
    bytes4 constant internal MULTICALL_WHITELIST_PREFIX = bytes4(keccak256("multiCallWithWhitelist(address,bytes[],bool[])"));
    bytes4 constant internal MULTICALL_SESSION_PREFIX = bytes4(keccak256("multiCallWithSession(address,address,address,uint256,bytes)"));

    bytes4 private constant ERC1271_ISVALIDSIGNATURE_BYTES32 = bytes4(keccak256("isValidSignature(bytes32,bytes)"));
    bytes4 private constant ERC721_RECEIVED = 0x150b7a02;

    // The Token storage
    ITransferStorage public whitelistStorage;
    // The Dapp authoriser
    IAuthoriser public authoriser;
    // The security period
    uint256 public securityPeriod;

    // *************** Events *************************** //

    event Transfer(address indexed wallet, address indexed token, uint256 indexed amount, address to, bytes data);
    event CalledContract(address indexed wallet, address indexed to, uint256 amount, bytes data);
    event AddedToWhitelist(address indexed wallet, address indexed target, uint64 whitelistAfter);
    event RemovedFromWhitelist(address indexed wallet, address indexed target);

    // *************** Modifiers *************************** //

    // *************** Constructor ************************ //

    constructor(
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        IGuardianStorage _guardianStorage,
        ITransferStorage _whitelistStorage,
        IAuthoriser _authoriser,
        uint256 _securityPeriod
    )
        BaseModule(_registry, _lockStorage, NAME)
        RelayerManager(_guardianStorage)
        public
    {
        whitelistStorage = _whitelistStorage;
        authoriser = _authoriser;
        securityPeriod = _securityPeriod;
    }

    // *************** External functions ************************ //

    function init(address _wallet) external override onlyWallet(_wallet) {
        // setup static calls
        IWallet(_wallet).enableStaticCall(address(this), ERC1271_ISVALIDSIGNATURE_BYTES32);
        IWallet(_wallet).enableStaticCall(address(this), ERC721_RECEIVED);
    }

    /**
     * @inheritdoc RelayerManager
     */
    function getRequiredSignatures(address, bytes calldata _data) public view override returns (uint256, OwnerSignature) {
        bytes4 methodId = Utils.functionPrefix(_data);
        if (methodId == TRANSFER_WHITELIST_PREFIX || methodId == MULTICALL_WHITELIST_PREFIX || methodId == ADD_MODULE_PREFIX) {
            return (1, OwnerSignature.Required);
        } 
        if (methodId == TRANSFER_SESSION_PREFIX) {
            return (1, OwnerSignature.Session);
        } 
        revert("TM: unknown method");
    }

    // /**
    // * @notice Lets the owner transfer tokens (ETH or ERC20) from a wallet.
    // * @param _wallet The target wallet.
    // * @param _token The address of the token to transfer.
    // * @param _to The destination address
    // * @param _amount The amoutn of token to transfer
    // * @param _data The data for the transaction
    // */
    // function transferTokenWithWithelist(
    //     address _wallet,
    //     address _token,
    //     address _to,
    //     uint256 _amount,
    //     bytes calldata _data
    // )
    //     external
    //     onlyWalletOwnerOrSelf(_wallet)
    //     onlyWhenUnlocked(_wallet)
    // {
    //     require(isWhitelisted(_wallet, _to), "TMV2: not whitelisted");
    //     doTransfer(_wallet, _token, _to, _amount, _data);
    // }

    function multiCallWithWhitelist(
        address _wallet,
        bytes[] calldata _transactions,
        bool[] calldata _isSpenderInData
    )
        external
        onlySelf()
        onlyWhenUnlocked(_wallet)
        returns (bytes[] memory)
    {
        require(_transactions.length == _isSpenderInData.length, "TM: invalid multiCall parameters");
        bytes[] memory results = new bytes[](_transactions.length);
        for(uint i = 0; i < _transactions.length; i++) {
            (address _to, uint256 _value, bytes memory _data) = abi.decode(_transactions[i], (address, uint256, bytes));
            address spender = _isSpenderInData[i] ? recoverSpender(_wallet, _data) : _to;
            require(isWhitelisted(_wallet, spender) || isAuthorised(_to, spender, _data), "TM: transaction not authorised");
            results[i] = invokeWallet(_wallet, _to, _value, _data);
        }
        return results;
    }

    function isAuthorised(address _contract, address _spender, bytes memory _data) internal returns (bool) {
        if (_contract == _spender) { 
            return authoriser.authorise(_contract, _data); // do we need to block calls to the wallet or modules?
        } else {
            return authoriser.authorise(_spender, "");
        }
    }

    function multiCallWithSession(
        address _wallet,
        bytes[] calldata _transactions
    )
        external
        onlySelf()
        onlyWhenUnlocked(_wallet)
        returns (bytes[] memory)
    {
        bytes[] memory results = new bytes[](_transactions.length);
        for(uint i = 0; i < _transactions.length; i++) {
            (address _to, uint256 _value, bytes memory _data) = abi.decode(_transactions[i], (address, uint256, bytes));
            results[i] = invokeWallet(_wallet, _to, _value, _data);
        }
        return results;
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
        onlyWalletOwnerOrSelf(_wallet)
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
        onlyWalletOwnerOrSelf(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        setWhitelist(_wallet, _target, 0);
        emit RemovedFromWhitelist(_wallet, _target);
    }

    /**
    * @notice Checks if an address is whitelisted for a wallet.
    * @param _wallet The target wallet.
    * @param _target The address.
    * @return _isWhitelisted true if the address is whitelisted.
    */
    function isWhitelisted(address _wallet, address _target) public view returns (bool _isWhitelisted) {
        uint whitelistAfter = whitelistStorage.getWhitelist(_wallet, _target);
        
        return whitelistAfter > 0 && whitelistAfter < block.timestamp;
    }

    // *************** Internal Functions ********************* //

    function recoverSpender(address _wallet, bytes memory _data) internal pure returns (address) {
        (bytes32 sig, address first, address second) = abi.decode(abi.encodePacked(bytes28(0), _data), (bytes32, address, address));
        if (first == _wallet) {
            return second;
        }
        return first;
    }

    function setWhitelist(address _wallet, address _target, uint256 _whitelistAfter) internal {
        whitelistStorage.setWhitelist(_wallet, _target, _whitelistAfter);
    }
}