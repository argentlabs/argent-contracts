// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.s

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IFilter.sol";
import "../ITokenPriceRegistry.sol";

interface IParaswap {

    struct Route {
        address payable exchange;
        address targetExchange;
        uint percent;
        bytes payload;
        uint256 networkFee; // only used for 0xV3
    }

    struct Path {
        address to;
        uint256 totalNetworkFee; // only used for 0xV3
        Route[] routes;
    }

    function multiSwap(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        Path[] memory path,
        uint256 mintPrice,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) external payable returns (uint256);
}


contract ParaswapFilter is IFilter {

    // bytes32(bytes4(keccak256("multiSwap(...)")))
    bytes32 constant internal MULTISWAP = 0x00000000000000000000000000000000000000000000000000000000cbd1603e;
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The token price registry
    ITokenPriceRegistry public tokenPriceRegistry;

    constructor(
        ITokenPriceRegistry _tokenPriceRegistry
    ) 
        public 
    {
        tokenPriceRegistry = _tokenPriceRegistry;
    }

    function isValid(address _wallet, address /*_spender*/, address /*_to*/, bytes calldata _data) external view override returns (bool) {
        (bytes32 sig,, address destToken) = abi.decode(abi.encodePacked(bytes28(0), _data), (bytes32, address, address));
        (address beneficiary) = abi.decode(_data[228:], (address)); // skipping 4 + 7*32 = 228 bytes
        return sig == 
            MULTISWAP &&
            (beneficiary == address(0) || beneficiary == _wallet) && 
            (destToken == ETH_TOKEN || tokenPriceRegistry.isTokenTradable(destToken));
    }
}