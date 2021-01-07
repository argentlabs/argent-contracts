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

import "./modules/IApprovedTransfer.sol";
import "./modules/ICompoundManager.sol";
import "./modules/IGuardianManager.sol";
import "./modules/ILockManager.sol";
import "./modules/INftTransfer.sol";
import "./modules/IRecoveryManager.sol";
import "./modules/ITokenExchanger.sol";
import "./modules/ITransferManager.sol";

/**
 * @title IWallet
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface IWallet is
  IApprovedTransfer,
  ICompoundManager,
  IGuardianManager,
  ILockManager,
  INftTransfer,
  IRecoveryManager,
  ITokenExchanger,
  ITransferManager {

  uint public version;
}