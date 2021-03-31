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

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./common/Utils.sol";
import "./common/BaseModule.sol";
import "../../lib_0.5/other/ERC20.sol";

/**
 * @title TransactionManager
 * @notice Module to execute transactions in sequence to e.g. transfer tokens (ETH, ERC20, ERC721, ERC1155) or call third-party contracts.
 * @author Julien Niset - <julien@argent.xyz>
 */
abstract contract TransactionManager is BaseModule {

    // Static calls
    bytes4 private constant ERC1271_IS_VALID_SIGNATURE = bytes4(keccak256("isValidSignature(bytes32,bytes)"));
    bytes4 private constant ERC721_RECEIVED = bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
    bytes4 private constant ERC1155_RECEIVED = bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"));
    bytes4 private constant ERC1155_BATCH_RECEIVED = bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"));
    bytes4 private constant ERC165_INTERFACE = bytes4(keccak256("supportsInterface(bytes4)"));

    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    // The time delay for adding a trusted contact
    uint256 internal immutable whitelistPeriod;

    // *************** Events *************************** //

    event AddedToWhitelist(address indexed wallet, address indexed target, uint64 whitelistAfter);
    event RemovedFromWhitelist(address indexed wallet, address indexed target);
    event SessionCreated(address indexed wallet, address sessionKey, uint64 expires);
    event SessionCleared(address indexed wallet, address sessionKey);
    // *************** Constructor ************************ //

    constructor(uint256 _whitelistPeriod) {
        whitelistPeriod = _whitelistPeriod;
    }

    // *************** External functions ************************ //

    /**
     * @notice Makes the target wallet execute a sequence of transactions authorised by the wallet owner.
     * The method reverts if any of the inner transactions reverts.
     * The method reverts if any of the inner transaction is not to a trusted contact or an authorised dapp.
     * @param _wallet The target wallet.
     * @param _transactions The sequence of transactions.
     */
    function multiCall(
        address _wallet,
        Call[] calldata _transactions
    )
        external
        onlySelf()
        onlyWhenUnlocked(_wallet)
        returns (bytes[] memory)
    {
        bytes[] memory results = new bytes[](_transactions.length);
        for(uint i = 0; i < _transactions.length; i++) {
            address spender = Utils.recoverSpender(_transactions[i].to, _transactions[i].data);
            require(
                (_transactions[i].value == 0 || spender == _transactions[i].to) &&
                (isWhitelisted(_wallet, spender) || authoriser.isAuthorised(_wallet, spender, _transactions[i].to, _transactions[i].data)),
                "TM: call not authorised");
            results[i] = invokeWallet(_wallet, _transactions[i].to, _transactions[i].value, _transactions[i].data);
        }
        return results;
    }

    /**
     * @notice Makes the target wallet execute a sequence of transactions authorised by a session key.
     * The method reverts if any of the inner transactions reverts.
     * @param _wallet The target wallet.
     * @param _transactions The sequence of transactions.
     */
    function multiCallWithSession(
        address _wallet,
        Call[] calldata _transactions
    )
        external
        onlySelf()
        onlyWhenUnlocked(_wallet)
        returns (bytes[] memory)
    {
        return multiCallWithApproval(_wallet, _transactions);
    }

    /**
     * @notice Makes the target wallet execute a sequence of transactions approved by a majority of guardians.
     * The method reverts if any of the inner transactions reverts.
     * @param _wallet The target wallet.
     * @param _transactions The sequence of transactions.
     */
    function multiCallWithGuardians(
        address _wallet,
        Call[] calldata _transactions
    )
        external 
        onlySelf()
        onlyWhenUnlocked(_wallet)
        returns (bytes[] memory)
    {
        return multiCallWithApproval(_wallet, _transactions);
    }

    /**
     * @notice Makes the target wallet execute a sequence of transactions approved by a majority of guardians.
     * The method reverts if any of the inner transactions reverts.
     * Upon success a new session is started.
     * @param _wallet The target wallet.
     * @param _transactions The sequence of transactions.
     */
    function multiCallWithGuardiansAndStartSession(
        address _wallet,
        Call[] calldata _transactions,
        address _sessionUser,
        uint64 _duration
    )
        external 
        onlySelf()
        onlyWhenUnlocked(_wallet)
        returns (bytes[] memory)
    {
        startSession(_wallet, _sessionUser, _duration);
        return multiCallWithApproval(_wallet, _transactions);
    }

    /**
    * @notice Clears the active session of a wallet if any.
    * @param _wallet The target wallet.
    */
    function clearSession(address _wallet) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        emit SessionCleared(_wallet, sessions[_wallet].key);
        _clearSession(_wallet);
    }

    /**
     * @notice Adds an address to the list of trusted contacts.
     * @param _wallet The target wallet.
     * @param _target The address to add.
     */
    function addToWhitelist(address _wallet, address _target) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        require(_target != _wallet, "TM: Cannot whitelist wallet");
        require(!registry.isRegisteredModule(_target), "TM: Cannot whitelist module");
        require(!isWhitelisted(_wallet, _target), "TM: target already whitelisted");

        uint256 whitelistAfter = block.timestamp + whitelistPeriod;
        setWhitelist(_wallet, _target, whitelistAfter);
        emit AddedToWhitelist(_wallet, _target, uint64(whitelistAfter));
    }

    /**
     * @notice Removes an address from the list of trusted contacts.
     * @param _wallet The target wallet.
     * @param _target The address to remove.
     */
    function removeFromWhitelist(address _wallet, address _target) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        setWhitelist(_wallet, _target, 0);
        emit RemovedFromWhitelist(_wallet, _target);
    }

    /**
    * @notice Checks if an address is a trusted contact for a wallet.
    * @param _wallet The target wallet.
    * @param _target The address.
    * @return _isWhitelisted true if the address is a trusted contact.
    */
    function isWhitelisted(address _wallet, address _target) public view returns (bool _isWhitelisted) {
        uint whitelistAfter = userWhitelist.getWhitelist(_wallet, _target);
        return whitelistAfter > 0 && whitelistAfter < block.timestamp;
    }
    
    /*
    * @notice Enable the static calls required to make the wallet compatible with the ERC1155TokenReceiver 
    * interface (see https://eips.ethereum.org/EIPS/eip-1155#erc-1155-token-receiver). This method only 
    * needs to be called for wallets deployed in version lower or equal to 2.4.0 as the ERC1155 static calls
    * are not available by default for these versions of BaseWallet
    * @param _wallet The target wallet.
    */
    function enableERC1155TokenReceiver(address _wallet) external onlyWalletOwnerOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        IWallet(_wallet).enableStaticCall(address(this), ERC165_INTERFACE);
        IWallet(_wallet).enableStaticCall(address(this), ERC1155_RECEIVED);
        IWallet(_wallet).enableStaticCall(address(this), ERC1155_BATCH_RECEIVED);
    }

    /**
     * @inheritdoc IModule
     */
    function supportsStaticCall(bytes4 _methodId) external pure override returns (bool _isSupported) {
        return _methodId == ERC1271_IS_VALID_SIGNATURE ||
               _methodId == ERC721_RECEIVED ||
               _methodId == ERC165_INTERFACE ||
               _methodId == ERC1155_RECEIVED ||
               _methodId == ERC1155_BATCH_RECEIVED;
    }

    /** ******************* Callbacks ************************** */

    /**
     * @notice Returns true if this contract implements the interface defined by
     * `interfaceId` (see https://eips.ethereum.org/EIPS/eip-165).
     */
    function supportsInterface(bytes4 _interfaceID) external pure returns (bool) {
        return  _interfaceID == ERC165_INTERFACE || _interfaceID == (ERC1155_RECEIVED ^ ERC1155_BATCH_RECEIVED);          
    }

    /**
    * @notice Implementation of EIP 1271.
    * Should return whether the signature provided is valid for the provided data.
    * @param _msgHash Hash of a message signed on the behalf of address(this)
    * @param _signature Signature byte array associated with _msgHash
    */
    function isValidSignature(bytes32 _msgHash, bytes memory _signature) external view returns (bytes4) {
        require(_signature.length == 65, "TM: invalid signature length");
        address signer = Utils.recoverSigner(_msgHash, _signature, 0);
        require(_isOwner(msg.sender, signer), "TM: Invalid signer");
        return ERC1271_IS_VALID_SIGNATURE;
    }


    fallback() external {
        bytes4 methodId = Utils.functionPrefix(msg.data);
        if(methodId == ERC721_RECEIVED || methodId == ERC1155_RECEIVED || methodId == ERC1155_BATCH_RECEIVED) {
            // solhint-disable-next-line no-inline-assembly
            assembly {                
                calldatacopy(0, 0, 0x04)
                return (0, 0x20)
            }
        }
    }

    // *************** Internal Functions ********************* //

    function enableDefaultStaticCalls(address _wallet) internal {
        // setup the static calls that are available for free for all wallets
        IWallet(_wallet).enableStaticCall(address(this), ERC1271_IS_VALID_SIGNATURE);
        IWallet(_wallet).enableStaticCall(address(this), ERC721_RECEIVED);
    }

    function multiCallWithApproval(address _wallet, Call[] calldata _transactions) internal returns (bytes[] memory) {
        bytes[] memory results = new bytes[](_transactions.length);
        for(uint i = 0; i < _transactions.length; i++) {
            results[i] = invokeWallet(_wallet, _transactions[i].to, _transactions[i].value, _transactions[i].data);
        }
        return results;
    }

    function startSession(address _wallet, address _sessionUser, uint64 _duration) internal {
        require(_sessionUser != address(0), "TM: Invalid session user");
        require(_duration > 0, "TM: Invalid session duration");

        uint64 expiry = SafeCast.toUint64(block.timestamp + _duration);
        sessions[_wallet] = Session(_sessionUser, expiry);
        emit SessionCreated(_wallet, _sessionUser, expiry);
    }

    function setWhitelist(address _wallet, address _target, uint256 _whitelistAfter) internal {
        userWhitelist.setWhitelist(_wallet, _target, _whitelistAfter);
    }
}