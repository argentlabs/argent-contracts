// Copyright (C) 2020  Argent Labs Ltd. <https://argent.xyz>

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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAugustusSwapper {
    function getTokenTransferProxy() external view returns (address);

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

    struct BuyRoute {
        address payable exchange;
        address targetExchange;
        uint256 fromAmount;
        uint256 toAmount;
        bytes payload;
        uint256 networkFee; // only used for 0xV3
    }

    // /**
    //  * @dev The function which performs the multi path swap.
    //  * @param fromToken Address of the source token
    //  * @param toToken Address of the destination token
    //  * @param fromAmount Amount of source tokens to be swapped
    //  * @param toAmount Minimum destination token amount expected out of this swap
    //  * @param expectedAmount Expected amount of destination tokens without slippage
    //  * @param path Route to be taken for this swap to take place
    //  * @param mintPrice Price of gas at the time of minting of gas tokens, if any. In wei. 0 means gas token will not be used
    //  * @param beneficiary Beneficiary address
    //  * @param donationPercentage Percentage of returned amount to be transferred to beneficiary, if beneficiary is available. If this is passed as
    //  * 0 then 100% will be transferred to beneficiary. Pass 10000 for 100%
    //  * @param referrer referral id
    //  */
    function multiSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        Path[] memory path,
        uint256 mintPrice,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) external payable returns (uint256);

    /**
     * @dev The function which performs the single path buy.
     * @param fromToken Address of the source token
     * @param toToken Address of the destination token
     * @param fromAmount Max amount of source tokens to be swapped
     * @param toAmount Destination token amount expected out of this swap
     * @param expectedAmount Expected amount of source tokens to be used without slippage
     * @param route Route to be taken for this swap to take place
     * @param mintPrice Price of gas at the time of minting of gas tokens, if any. In wei. 0 means gas token will not be used
     * @param beneficiary Beneficiary address
     * @param donationPercentage Percentage of returned amount to be transferred to beneficiary, if beneficiary is available. If this is passed as
     * 0 then 100% will be transferred to beneficiary. Pass 10000 for 100%
     * @param referrer referral id
     */
    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        BuyRoute[] memory route,
        uint256 mintPrice,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) external payable returns (uint256);
}