// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./WalletStorage.sol";

/**
 * @title BaseModule
 * @notice Base Feature contract that contains methods common to all Feature contracts.
 * @author Julien Niset - <julien@argent.xyz>, Olivier VDB - <olivier@argent.xyz>
 */
contract BaseModule is WalletStorage {
    using SafeMath for uint256;

    /**
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked() {
        require(!isLocked(), "BM: wallet locked");
        _;
    }

    /**
     * @notice Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked() {
        require(isLocked(), "BM: wallet must be locked");
        _;
    }

    /**
     * @notice Throws if the sender is not the owner of the target wallet.
     */
    modifier onlyWalletOwner() {
        require(owner == msg.sender, "BM: must be wallet owner");
        _;
    }

    /**
     * @notice Throws if the caller is not a guardian for the wallet.
     */
    modifier onlyGuardian() {
        bool isGuardian = info[msg.sender].exists;
        require(isGuardian, "BM: must be guardian");
        _;
    }

    /**
     * @notice Checks if a wallet is locked.
     * @return _isLocked `true` if the wallet is locked otherwise `false`.
     */
    function isLocked() public view returns (bool) {
        return lock > block.timestamp;
    }

    /**
    * @notice Checks that the wallet address provided as the first parameter of _data matches _wallet
    * @return false if the addresses are different.
    */
    function verifyData(address _wallet, bytes calldata _data) internal pure returns (bool) {
        require(_data.length >= 36, "BM: Invalid dataWallet");
        address dataWallet = abi.decode(_data[4:], (address));
        return dataWallet == _wallet;
    }

    /**
     * @notice Returns the number of guardians for a wallet.
     * @return the number of guardians.
     */
    function guardianCount() external view returns (uint256) {
        return guardians.length;
    }

    /**
     * @notice Checks if an account is a guardian for a wallet.
     * @param _guardian The account.
     * @return true if the account is a guardian for a wallet.
     */
    function isGuardian(address _guardian) external view returns (bool) {
        return info[_guardian].exists;
    }
}