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

import "./common/OnlyOwnerFeature.sol";
import "../infrastructure/storage/ITokenPriceStorage.sol";

/**
 * @title NftTransfer
 * @notice Module to transfer NFTs (ERC721),
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract NftTransfer is OnlyOwnerFeature {

    bytes32 constant NAME = "NftTransfer";

    // Equals to `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
    bytes4 private constant ERC721_RECEIVED = 0x150b7a02;

    // The address of the CryptoKitties contract
    address public ckAddress;
    // The token price storage
    ITokenPriceStorage public tokenPriceStorage;

    // *************** Events *************************** //

    event NonFungibleTransfer(address indexed wallet, address indexed nftContract, uint256 indexed tokenId, address to, bytes data);

    // *************** Constructor ********************** //

    constructor(
        IModuleRegistry _registry,
        IGuardianStorage _guardianStorage,
        ITokenPriceStorage _tokenPriceStorage,
        IVersionManager _versionManager,
        address _ckAddress
    )
        BaseFeature(_registry, _guardianStorage, _versionManager, NAME)
        public
    {
        ckAddress = _ckAddress;
        tokenPriceStorage = _tokenPriceStorage;
    }

    // *************** External/Public Functions ********************* //

    /**
     * @inheritdoc IFeature
     */
    function getStaticCallSignatures() external virtual override view returns (bytes4[] memory _sigs) {
        _sigs = new bytes4[](1);
        _sigs[0] = ERC721_RECEIVED;
    }

    /**
     * @notice Handle the receipt of an NFT
     * @notice An ERC721 smart contract calls this function on the recipient contract
     * after a `safeTransfer`. If the recipient is a BaseWallet, the call to onERC721Received
     * will be forwarded to the method onERC721Received of the present module.
     * @return bytes4 `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
     */
    function onERC721Received(
        address /* operator */,
        address /* from */,
        uint256 /* tokenId */,
        bytes calldata /* data*/
    )
        external
        returns (bytes4)
    {
        return ERC721_RECEIVED;
    }

    /**
    * @notice Lets the owner transfer NFTs from a wallet.
    * @param _wallet The target wallet.
    * @param _nftContract The ERC721 address.
    * @param _to The recipient.
    * @param _tokenId The NFT id
    * @param _safe Whether to execute a safe transfer or not
    * @param _data The data to pass with the transfer.
    */
    function transferNFT(
        address _wallet,
        address _nftContract,
        address _to,
        uint256 _tokenId,
        bool _safe,
        bytes calldata _data
    )
        external
        onlyWalletOwnerOrFeature(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        bytes memory methodData;
        if (_nftContract == ckAddress) {
            methodData = abi.encodeWithSignature("transfer(address,uint256)", _to, _tokenId);
        } else {
           if (_safe) {
               methodData = abi.encodeWithSignature(
                   "safeTransferFrom(address,address,uint256,bytes)", _wallet, _to, _tokenId, _data);
           } else {
               require(!coveredByDailyLimit(_nftContract), "NT: Forbidden ERC20 contract");
               methodData = abi.encodeWithSignature(
                   "transferFrom(address,address,uint256)", _wallet, _to, _tokenId);
           }
        }
        checkAuthorisedFeatureAndInvokeWallet(_wallet, _nftContract, 0, methodData);
        emit NonFungibleTransfer(_wallet, _nftContract, _tokenId, _to, _data);
    }

    // *************** Internal Functions ********************* //

    /**
    * @notice Returns true if the contract is a supported ERC20.
    * @param _contract The address of the contract.
     */
    function coveredByDailyLimit(address _contract) internal view returns (bool) {
        return tokenPriceStorage.getTokenPrice(_contract) > 0;
    }

}