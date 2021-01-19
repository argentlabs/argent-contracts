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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

import "./Utils.sol";
import "./WalletStorage.sol";
import "../../../lib/other/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title BaseModule
 * @notice Base Feature contract that contains methods common to all Feature contracts.
 * @author Julien Niset - <julien@argent.xyz>, Olivier VDB - <olivier@argent.xyz>
 */
contract BaseModule is WalletStorage {

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
    modifier onlyWalletOwner() { // TODO: Better name this, maybe onlyWalletOwnerOrSelf
        require(owner == msg.sender || msg.sender == address(this), "BM: must be wallet owner");
        _;
    }

    /**
     * @notice Throws if the sender is not an authorised feature of the target wallet.
     */
    modifier onlyWallet() {
        require(msg.sender == address(this), "BM: caller must be the wallet itself");
        _;
    }

    /**
     * @notice Throws if the caller is not a guardian for the wallet.
     */
    modifier onlyGuardian() {
        require(isGuardian(msg.sender), "BM: must be guardian");
        _;
    }

    /**
     * @notice Checks if a wallet is locked.
     * @return _isLocked `true` if the wallet is locked otherwise `false`.
     */
    function isLocked() public view returns (bool) {
        return walletLock.releaseAfter > block.timestamp;
    }

    /**
     * @notice Returns the number of guardians for a wallet.
     * @return the number of guardians.
     */
    function guardianCount() public view returns (uint256) {
        return guardians.length;
    }

    /**
     * @notice Checks if an account is a guardian for a wallet.
     * @param _guardian The account.
     * @return true if the account is a guardian for a wallet.
     */
    function isGuardian(address _guardian) public view returns (bool) {
        return info[_guardian].exists;
    }

    /**
    * @notice Checks if an address is a guardian or an account authorised to sign on behalf of a smart-contract guardian.
    * @param _guardian the address to test
    * @return `true` if the address is a guardian for the wallet otherwise `false`.
    */
    function isGuardianOrGuardianSigner(address _guardian) public view returns (bool) {
        if (guardians.length == 0 || _guardian == address(0)) {
            return false;
        }
        bool isFound = false;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (!isFound) {
                // check if _guardian is an account guardian
                if (_guardian == guardians[i]) {
                    isFound = true;
                    continue;
                }
                // check if _guardian is the owner of a smart contract guardian
                if (Utils.isContract(guardians[i]) && isGuardianOwner(guardians[i], _guardian)) {
                    isFound = true;
                    continue;
                }
            }
        }
        return isFound;
    }

    /**
    * @dev Checks if an address is the owner of a guardian contract.
    * The method does not revert if the call to the owner() method consumes more then 5000 gas.
    * @param _guardian The guardian contract
    * @param _owner The owner to verify.
    */
    function isGuardianOwner(address _guardian, address _owner) internal view returns (bool) {
        address owner = address(0);
        bytes4 sig = bytes4(keccak256("owner()"));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(ptr,sig)
            let result := staticcall(5000, _guardian, ptr, 0x20, ptr, 0x20)
            if eq(result, 1) {
                owner := mload(ptr)
            }
        }
        return owner == _owner;
    }
}