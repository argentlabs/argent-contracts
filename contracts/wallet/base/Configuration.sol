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

import "./DataTypes.sol";
import "../../infrastructure/ICompoundRegistry.sol";
import "../../infrastructure/IComptroller.sol";
import "../../infrastructure/IDexRegistry.sol";
import "../../infrastructure/ITokenPriceRegistry.sol";

/**
 * @title Interface for the Registry of function signatures
 * @notice Used by the Proxy delegate to resolve registered function signatures against implementation contracts
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract Configuration {
    mapping (bytes4 => DataTypes.RelaySignatures) public relaySignatures;

    // The token price registry
    ITokenPriceRegistry public tokenPriceRegistry;

    // The Compound IComptroller contract
    IComptroller public comptroller;
    // The registry mapping underlying with cTokens
    ICompoundRegistry public compoundRegistry;

    // The lock period
    uint256 public lockPeriod;

    // The address of the CryptoKitties contract
    address public ckAddress;
    // Recovery period
    uint256 public recoveryPeriod;

    // The address of the Paraswap Proxy contract
    address public paraswapProxy;
    // The address of the Paraswap contract
    address public paraswapSwapper;
    // The label of the referrer
    string public referrer;
    // Registry of authorised exchanges
    IDexRegistry public dexRegistry;

    // The address of the WETH token
    address public wethToken;
    // The security period
    uint256 public securityPeriod;
    // The execution security window
    uint256 public securityWindow;
    // The default limit
    uint128 public defaultLimit;
}