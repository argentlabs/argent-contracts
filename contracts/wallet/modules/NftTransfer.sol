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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

import "../base/BaseModule.sol";
import "../base/Configuration.sol";
import "./INftTransfer.sol";

/**
 * @title NftTransfer
 * @notice Module to transfer NFTs (ERC721),
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract NftTransfer is INftTransfer, BaseModule {

    // Equals to `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
    bytes4 private constant ERC721_RECEIVED = 0x150b7a02;

    // *************** External/Public Functions ********************* //

    // function getStaticCallSignatures() external virtual override view returns (bytes4[] memory _sigs) {
    //     _sigs = new bytes4[](1);
    //     _sigs[0] = ERC721_RECEIVED;
    // }

    /**
     * @inheritdoc INftTransfer
     */
    function onERC721Received(
        address /* operator */,
        address /* from */,
        uint256 /* tokenId */,
        bytes calldata /* data*/
    )
        external override
        returns (bytes4)
    {
        return ERC721_RECEIVED;
    }

    /**
     * @inheritdoc INftTransfer
     */
    function transferNFT(
        address _nftContract,
        address _to,
        uint256 _tokenId,
        bool _safe,
        bytes calldata _data
    )
        external override
        onlyWalletOwner()
        onlyWhenUnlocked()
    {
        bytes memory methodData;
        address ckAddress = Configuration(registry).ckAddress();
        if (_nftContract == ckAddress) {
            methodData = abi.encodeWithSignature("transfer(address,uint256)", _to, _tokenId);
        } else {
           if (_safe) {
               methodData = abi.encodeWithSignature(
                   "safeTransferFrom(address,address,uint256,bytes)", address(this), _to, _tokenId, _data);
           } else {
               require(!coveredByDailyLimit(_nftContract), "NT: Forbidden ERC20 contract");
               methodData = abi.encodeWithSignature(
                   "transferFrom(address,address,uint256)", address(this), _to, _tokenId);
           }
        }
        // TODO: better replacement for wallet invoke
        _nftContract.call(methodData);
        emit NonFungibleTransfer(address(this), _nftContract, _tokenId, _to, _data);
    }

    // *************** Internal Functions ********************* //

    /**
    * @notice Returns true if the contract is a supported ERC20.
    * @param _contract The address of the contract.
     */
    function coveredByDailyLimit(address _contract) internal view returns (bool) {
        ITokenPriceRegistry _tokenPriceRegistry = Configuration(registry).tokenPriceRegistry();
        return _tokenPriceRegistry.getTokenPrice(_contract) > 0;
    }
}