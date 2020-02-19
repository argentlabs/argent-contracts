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
import "../base/Managed.sol";
import "./ENSResolver.sol";

/**
 * @title ArgentENSResolver
 * @dev Basic implementation of a Resolver.
 * The contract defines a manager role who is the only role that can add a new name
 * to the list of resolved names.
 * @author Julien Niset - <julien@argent.im>
 */
contract ArgentENSResolver is Owned, Managed, ENSResolver {

    bytes4 constant SUPPORT_INTERFACE_ID = 0x01ffc9a7;
    bytes4 constant ADDR_INTERFACE_ID = 0x3b3b57de;
    bytes4 constant NAME_INTERFACE_ID = 0x691f3431;

    // mapping between namehash and resolved records
    mapping (bytes32 => Record) records;

    struct Record {
        address addr;
        string name;
    }

    // *************** Public Functions ********************* //

    /**
     * @dev Lets the manager set the address associated with an ENS node.
     * @param _node The node to update.
     * @param _addr The address to set.
     */
    function setAddr(bytes32 _node, address _addr) public onlyManager {
        records[_node].addr = _addr;
        emit AddrChanged(_node, _addr);
    }

    /**
     * @dev Lets the manager set the name associated with an ENS node.
     * @param _node The node to update.
     * @param _name The name to set.
     */
    function setName(bytes32 _node, string memory _name) public onlyManager {
        records[_node].name = _name;
        emit NameChanged(_node, _name);
    }

    /**
     * @dev Gets the address associated to an ENS node.
     * @param _node The target node.
     * @return the address of the target node.
     */
    function addr(bytes32 _node) public view returns (address) {
        return records[_node].addr;
    }

    /**
     * @dev Gets the name associated to an ENS node.
     * @param _node The target ENS node.
     * @return the name of the target ENS node.
     */
    function name(bytes32 _node) public view returns (string memory) {
        return records[_node].name;
    }

    /**
     * @dev Returns true if the resolver implements the interface specified by the provided hash.
     * @param _interfaceID The ID of the interface to check for.
     * @return True if the contract implements the requested interface.
     */
    function supportsInterface(bytes4 _interfaceID) public pure returns (bool) {
        return _interfaceID == SUPPORT_INTERFACE_ID || _interfaceID == ADDR_INTERFACE_ID || _interfaceID == NAME_INTERFACE_ID;
    }

}
