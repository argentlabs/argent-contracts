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
import "../base/Owned.sol";

/**
 * @title DappRegistry
 * @dev Registry of dapp contracts and methods that have been authorised by Argent.
 * Registered methods can be authorised immediately for a dapp key and a wallet while
 * the authoirsation of unregistered methods is delayed for 24 hours.
 * @author Julien Niset - <julien@argent.im>
 */
contract DappRegistry is Owned {

    // [contract][signature][bool]
    mapping (address => mapping (bytes4 => bool)) internal authorised;

    event Registered(address indexed _contract, bytes4[] _methods);
    event Deregistered(address indexed _contract, bytes4[] _methods);

    /**
     * @dev Registers a list of methods for a dapp contract.
     * @param _contract The dapp contract.
     * @param _methods The dapp methods.
     */
    function register(address _contract, bytes4[] calldata _methods) external onlyOwner {
        for (uint i = 0; i < _methods.length; i++) {
            authorised[_contract][_methods[i]] = true;
        }
        emit Registered(_contract, _methods);
    }

    /**
     * @dev Deregisters a list of methods for a dapp contract.
     * @param _contract The dapp contract.
     * @param _methods The dapp methods.
     */
    function deregister(address _contract, bytes4[] calldata _methods) external onlyOwner {
        for (uint i = 0; i < _methods.length; i++) {
            authorised[_contract][_methods[i]] = false;
        }
        emit Deregistered(_contract, _methods);
    }

    /**
     * @dev Checks if a method is registered for a dapp contract.
     * @param _contract The dapp contract.
     * @param _method The dapp method.
     * @return true if the method is registered.
     */
    function isRegistered(address _contract, bytes4 _method) external view returns (bool) {
        return authorised[_contract][_method];
    }

    /**
     * @dev Checks if a list of methods are registered for a dapp contract.
     * @param _contract The dapp contract.
     * @param _methods The dapp methods.
     * @return true if all the methods are registered.
     */
    function isRegistered(address _contract, bytes4[] calldata _methods) external view returns (bool) {
        for (uint i = 0; i < _methods.length; i++) {
            if (!authorised[_contract][_methods[i]]) {
                return false;
            }
        }
        return true;
    }
}
