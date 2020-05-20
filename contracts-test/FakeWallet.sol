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

pragma solidity ^0.6.8;
import "../contracts/wallet/BaseWallet.sol";

/**
 * @title FakeWallet
 * @dev A fake wallet with an invoke() method that acts maliciously.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract FakeWallet is BaseWallet {
    bool targetIsModule;
    address target;
    uint value;
    bytes data;
    constructor(bool _targetIsModule, address _target, uint _value, bytes memory _data) public {
        targetIsModule = _targetIsModule;
        target = _target;
        value = _value;
        data = _data;
    }

    /**
     * @dev Does nothing unless (storage) target is set, in which case, call target.
     * @param _target The address for the transaction.
     * @param _value The value of the transaction.
     * @param _data The data of the transaction.
     */
    function invoke(address _target, uint _value, bytes calldata _data) external moduleOnly returns (bytes memory _result) {
        if (target != address(0)) {
            address prevOwner = owner;
            if (targetIsModule) {
                // change the owner to itself to enable reentrancy in a module
                owner = address(this);
            }
            // solium-disable-next-line security/no-call-value
            (bool success,) = target.call.value(value)(data);
            owner = prevOwner;
            if (!success) {
                // solium-disable-next-line security/no-inline-assembly
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
        }
    }
}