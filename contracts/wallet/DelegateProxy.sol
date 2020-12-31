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

import "../infrastructure/IRegistry.sol";
import "../base/Owned.sol";

/**
 * @title DelegateProxy
 * @notice Proxy that delegates all calls to a registered set of upgradable implementation contracts
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract DelegateProxy is Owned {

    address public registry;

    event Received(uint indexed value, address indexed sender, bytes data);

    fallback() external payable { // solhint-disable-line no-complex-fallback
        address destination = IRegistry(registry).lookup(msg.sig);

        // solhint-disable-next-line no-inline-assembly
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), destination, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 1 { return (0, returndatasize()) }
            default { revert(0, returndatasize()) }
        }
    }

    receive() external payable {
        emit Received(msg.value, msg.sender, msg.data);
    }

    function setRegistry(address _registry) public
    onlyOwner
    {
      registry = _registry;
    }
}