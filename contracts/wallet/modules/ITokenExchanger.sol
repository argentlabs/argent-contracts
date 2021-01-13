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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../infrastructure/IAugustusSwapper.sol";
import "../../infrastructure/ITokenPriceRegistry.sol";
import "../../infrastructure/IDexRegistry.sol";

/**
 * @title ITokenExchanger
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface ITokenExchanger {
    event TokenExchanged(address indexed wallet, address srcToken, uint srcAmount, address destToken, uint destAmount);

    /**
     * @notice Lets the owner of the wallet execute a "sell" trade (fixed source amount, variable destination amount).
     * @param _srcToken The address of the source token.
     * @param _destToken The address of the destination token.
     * @param _srcAmount The exact amount of source tokens to sell.
     * @param _minDestAmount The minimum amount of destination tokens required for the trade.
     * @param _expectedDestAmount The expected amount of destination tokens (used only in ParaSwap's Swapped event).
     * @param _path Sequence of sets of weighted ParaSwap routes. Each route specifies an exchange to use to convert a given (exact) amount of
     * a given source token into a given (minimum) amount of a given destination token. The path is a sequence of sets of weighted routes where
     * the destination token of a set of weighted routes matches the source token of the next set of weighted routes in the path.
     * @param _mintPrice gasPrice (in wei) at the time the gas tokens were minted by ParaSwap. 0 means gas token will not be used by ParaSwap
     */
    function sell(
        address _srcToken,
        address _destToken,
        uint256 _srcAmount,
        uint256 _minDestAmount,
        uint256 _expectedDestAmount,
        IAugustusSwapper.Path[] calldata _path,
        uint256 _mintPrice
    ) external;

     /**
     * @notice Lets the owner of the wallet execute a "buy" trade (fixed destination amount, variable source amount).
     * @param _srcToken The address of the source token.
     * @param _destToken The address of the destination token.
     * @param _maxSrcAmount The maximum amount of source tokens to use for the trade.
     * @param _destAmount The exact amount of destination tokens to buy.
     * @param _expectedSrcAmount The expected amount of source tokens (used only in ParaSwap's Bought event).
     * @param _routes Set of weighted ParaSwap routes. Each route specifies an exchange to use to convert a given (maximum) amount of a given
     * source token into a given (exact) amount of a given destination token.
     * @param _mintPrice gasPrice (in wei) at the time the gas tokens were minted by ParaSwap. 0 means gas token will not be used by ParaSwap
     */
    function buy(
        address _srcToken,
        address _destToken,
        uint256 _maxSrcAmount,
        uint256 _destAmount,
        uint256 _expectedSrcAmount,
        IAugustusSwapper.BuyRoute[] calldata _routes,
        uint256 _mintPrice
    ) external;
}