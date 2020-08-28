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

pragma solidity ^0.5.4;

import "../../infrastructure/storage/Storage.sol";
import "../../infrastructure/storage/ITransferStorage.sol";

/**
 * @title TransferStorage
 * @notice Contract storing the state of wallets related to transfers (limit and whitelist).
 * The contract only defines basic setters and getters with no logic. Only modules authorised
 * for a wallet can modify its state.
 * @author Julien Niset - <julien@argent.im>
 */
contract TransferStorage is ITransferStorage, Storage {

    // wallet specific storage
    mapping (address => mapping (address => uint256)) internal whitelist;

    // *************** External Functions ********************* //

    /**
     * @notice Lets an authorised module add or remove an account from the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The account to add/remove.
     * @param _whitelistAfter The epoch time at which an account starts to be whitelisted, or zero if the account is not whitelisted
     */
    function setWhitelist(address _wallet, address _target, uint256 _whitelistAfter) external onlyModule(_wallet) {
        whitelist[_wallet][_target] = _whitelistAfter;
    }

    /**
     * @notice Gets the whitelist state of an account for a wallet.
     * @param _wallet The target wallet.
     * @param _target The account.
     * @return the epoch time at which an account starts to be whitelisted, or zero if the account is not whitelisted.
     */
    function getWhitelist(address _wallet, address _target) external view returns (uint256) {
        return whitelist[_wallet][_target];
    }
}