// Copyright (C) 2020 Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity >=0.5.4 <0.8.0;

/**
 * @title IComptroller
 * @notice Interface for Comptroller
 */
 interface IComptroller {
    function enterMarkets(address[] calldata _cTokens) external returns (uint[] memory);
    function exitMarket(address _cToken) external returns (uint);
    function getAssetsIn(address _account) external view returns (address[] memory);
    function getAccountLiquidity(address _account) external view returns (uint, uint, uint);
    function checkMembership(address account, ICToken cToken) external view returns (bool);
}

interface ICToken {
    function comptroller() external view returns (address);
    function underlying() external view returns (address);
    function symbol() external view returns (string memory);
    function exchangeRateCurrent() external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function balanceOf(address _account) external view returns (uint256);
    function borrowBalanceCurrent(address _account) external returns (uint256);
    function borrowBalanceStored(address _account) external view returns (uint256);
    function redeem(uint redeemTokens) external returns (uint);
    function redeemUnderlying(uint redeemAmount) external returns (uint);
    function mint(uint mintAmount) external payable returns (uint);
    function borrow(uint borrowAmount) external returns (uint);
    function repayBorrow(uint repayAmount) external returns (uint);
    function repayBorrow() external payable;
}