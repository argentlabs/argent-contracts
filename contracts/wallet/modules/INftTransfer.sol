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

import "../../infrastructure/ITokenPriceRegistry.sol";

/**
 * @title INftTransfer
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface INftTransfer {
    event NonFungibleTransfer(address indexed wallet, address indexed nftContract, uint256 indexed tokenId, address to, bytes data);

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
        returns (bytes4);
  
    /**
    * @notice Lets the owner transfer NFTs from a wallet.
    * @param _nftContract The ERC721 address.
    * @param _to The recipient.
    * @param _tokenId The NFT id
    * @param _safe Whether to execute a safe transfer or not
    * @param _data The data to pass with the transfer.
    */
    function transferNFT(
        address _nftContract,
        address _to,
        uint256 _tokenId,
        bool _safe,
        bytes calldata _data
    )
        external;
}