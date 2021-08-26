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

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.3;

import "argent-trustlists/contracts/interfaces/IFilter.sol";
import "argent-trustlists/contracts/DappRegistry.sol";
import "../storage/ITransferStorage.sol";
import "../../modules/common/Utils.sol";

/**
 * @title MultiCallHelper
 * @notice Helper contract that can be used to check in 1 call if and why a sequence of transactions is authorised to be executed by a wallet.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract MultiCallHelper {

    uint256 private constant MAX_UINT = type(uint256).max;

    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    // The trusted contacts storage
    ITransferStorage internal immutable userWhitelist;
    // The dapp registry contract
    DappRegistry internal immutable dappRegistry;

    constructor(ITransferStorage _userWhitelist, DappRegistry _dappRegistry) {
        userWhitelist = _userWhitelist;
        dappRegistry = _dappRegistry;
    }

    /**
     * @notice Checks if a sequence of transactions is authorised to be executed by a wallet.
     * The method returns false if any of the inner transaction is not to a trusted contact or an authorised dapp.
     * @param _wallet The target wallet.
     * @param _transactions The sequence of transactions.
     */
    function isMultiCallAuthorised(address _wallet, Call[] calldata _transactions) external view returns (bool) {
        for(uint i = 0; i < _transactions.length; i++) {
            address spender = Utils.recoverSpender(_transactions[i].to, _transactions[i].data);
            if (
                (spender != _transactions[i].to && _transactions[i].value != 0) ||
                (!isWhitelisted(_wallet, spender) && isAuthorised(_wallet, spender, _transactions[i].to, _transactions[i].data) == MAX_UINT)
            ) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Checks if each of the transaction of a sequence of transactions is authorised to be executed by a wallet.
     * For each transaction of the sequence it returns an Id where:
     *     - Id is in [0,255]: the transaction is to an address authorised in registry Id of the DappRegistry
     *     - Id = 256: the transaction is to an address authorised in the trusted contacts of the wallet
     *     - Id = MAX_UINT: the transaction is not authorised
     * @param _wallet The target wallet.
     * @param _transactions The sequence of transactions.
     */
    function multiCallAuthorisation(address _wallet, Call[] calldata _transactions) external view returns (uint256[] memory registryIds) {
        registryIds = new uint256[](_transactions.length);
        for(uint i = 0; i < _transactions.length; i++) {
            address spender = Utils.recoverSpender(_transactions[i].to, _transactions[i].data);
            if (spender != _transactions[i].to && _transactions[i].value != 0) {
                registryIds[i] = MAX_UINT;
            } else if (isWhitelisted(_wallet, spender)) {
                registryIds[i] = 256;
            } else {
                registryIds[i] = isAuthorised(_wallet, spender, _transactions[i].to, _transactions[i].data);
            }
        }
    }

    function isAuthorised(address _wallet, address _spender, address _to, bytes calldata _data) internal view returns (uint256) {
        uint registries = uint(dappRegistry.enabledRegistryIds(_wallet));
        // Check Argent Default Registry first. It is enabled by default, implying that a zero 
        // at position 0 of the `registries` bit vector means that the Argent Registry is enabled)
        for(uint registryId = 0; registryId == 0 || (registries >> registryId) > 0; registryId++) {
            bool isEnabled = (((registries >> registryId) & 1) > 0) /* "is bit set for regId?" */ == (registryId > 0) /* "not Argent registry?" */;
            if(isEnabled) { // if registryId is enabled
                uint auth = uint(dappRegistry.authorisations(uint8(registryId), _spender)); 
                uint validAfter = auth & 0xffffffffffffffff;
                if (0 < validAfter && validAfter <= block.timestamp) { // if the current time is greater than the validity time
                    address filter = address(uint160(auth >> 64));
                    if(filter == address(0) || IFilter(filter).isValid(_wallet, _spender, _to, _data)) {
                        return registryId;
                    }
                }
            }
        }
        return MAX_UINT;
    }

    function isAuthorisedInRegistry(address _wallet, Call[] calldata _transactions, uint8 _registryId) external view returns (bool) {
        for(uint i = 0; i < _transactions.length; i++) {
            address spender = Utils.recoverSpender(_transactions[i].to, _transactions[i].data);

            uint auth = uint(dappRegistry.authorisations(_registryId, spender)); 
            uint validAfter = auth & 0xffffffffffffffff;
            if (0 < validAfter && validAfter <= block.timestamp) { // if the current time is greater than the validity time
                address filter = address(uint160(auth >> 64));
                if(filter != address(0) && !IFilter(filter).isValid(_wallet, spender, _transactions[i].to, _transactions[i].data)) {
                    return false;
                }
            } else {
                return false;
            }
        }

        return true;
    }

    function isWhitelisted(address _wallet, address _target) internal view returns (bool _isWhitelisted) {
        uint whitelistAfter = userWhitelist.getWhitelist(_wallet, _target);
        return whitelistAfter > 0 && whitelistAfter < block.timestamp;
    }
}