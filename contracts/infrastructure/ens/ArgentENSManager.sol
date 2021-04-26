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

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.3;
import "../../../lib_0.5/ens/ENS.sol";
import "../../modules/common/Utils.sol";
import "./IENSManager.sol";
import "./IENSResolver.sol";
import "./IReverseRegistrar.sol";
import "../base/Managed.sol";

/**
 * @title ArgentENSManager
 * @notice Implementation of an ENS manager that orchestrates the complete registration of subdomains for a single root (e.g. argent.eth).
 * The contract defines a manager role who is the only role that can trigger the registration of a new subdomain.
 * @author Julien Niset - <julien@argent.im>
 */
contract ArgentENSManager is IENSManager, Owned, Managed {

    // The managed root name
    string public rootName;
    // The managed root node
    bytes32 immutable public rootNode;
    // The ENS registry
    ENS immutable public ensRegistry;
    // The ENS resolver to use
    IENSResolver public ensResolver;

    // namehash('addr.reverse')
    bytes32 constant public ADDR_REVERSE_NODE = 0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2;


   modifier validateENSLabel(string memory _label) {
      require(bytes(_label).length != 0, "AEM: ENS label must be defined");
      _;
    }

    // *************** Constructor ********************** //

    /**
     * @notice Constructor that sets the ENS root name and root node to manage.
     * @param _rootName The root name (e.g. argentx.eth).
     * @param _rootNode The node of the root name (e.g. namehash(argentx.eth)).
     * @param _ensRegistry The address of the ENS registry
     * @param _ensResolver The address of the ENS resolver
     */
    constructor(string memory _rootName, bytes32 _rootNode, address _ensRegistry, address _ensResolver) {
        rootName = _rootName;
        rootNode = _rootNode;
        ensRegistry = ENS(_ensRegistry);
        ensResolver = IENSResolver(_ensResolver);
    }

    // *************** External Functions ********************* //

    /**
     * @inheritdoc IENSManager
     */
    function changeRootnodeOwner(address _newOwner) external override onlyOwner {
        ensRegistry.setOwner(rootNode, _newOwner);
        emit RootnodeOwnerChange(rootNode, _newOwner);
    }

    /**
     * @notice Lets the owner change the address of the ENS resolver contract.
     * @param _ensResolver The address of the ENS resolver contract.
     */
    function changeENSResolver(address _ensResolver) external onlyOwner {
        require(_ensResolver != address(0), "AEM: cannot set empty resolver");
        ensResolver = IENSResolver(_ensResolver);
        emit ENSResolverChanged(_ensResolver);
    }

    /**
     * @inheritdoc IENSManager
     */
    function register(string calldata _label, address _owner, bytes calldata _managerSignature) external override validateENSLabel(_label) {
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(_owner, _label))));
        validateManagerSignature(signedHash, _managerSignature);

        _register(_label, _owner);
    }

    /**
     * @inheritdoc IENSManager
     */
    function register(string calldata _label, address _owner) external override onlyManager validateENSLabel(_label) {
        _register(_label, _owner);
    }

    function _register(string calldata _label, address _owner) internal {
        bytes32 labelNode = keccak256(abi.encodePacked(_label));
        bytes32 node = keccak256(abi.encodePacked(rootNode, labelNode));
        address currentOwner = ensRegistry.owner(node);
        require(currentOwner == address(0), "AEM: label is already owned");

        // Forward ENS
        ensRegistry.setSubnodeRecord(rootNode, labelNode, _owner, address(ensResolver), 0);
        ensResolver.setAddr(node, _owner);

        string memory name = string(abi.encodePacked(_label, ".", rootName));

        // Optionally set the reverse ENS
        bytes32 reverseNode = IReverseRegistrar(_getENSReverseRegistrar()).node(_owner);

        if(ensRegistry.resolver(reverseNode) == address(ensResolver)) {
            ensResolver.setName(reverseNode, name);
        }

        emit Registered(_owner, name);
    }

    /**
     * @notice Throws if the sender is not a manager and the manager's signature for the creation of the new wallet is invalid.
     * @param _signedHash The signed hash
     * @param _managerSignature The manager's signature
     */
    function validateManagerSignature(bytes32 _signedHash, bytes memory _managerSignature) internal view {
        address user;
        if(_managerSignature.length != 65) {
            user = msg.sender;
        } else {
            user = Utils.recoverSigner(_signedHash, _managerSignature, 0);
        }
        require(managers[user], "AEM: user is not manager");
    }

    /**
     * @inheritdoc IENSManager
     */
    function getENSReverseRegistrar() external view override returns (address) {
        return _getENSReverseRegistrar();
    }

    // *************** Public Functions ********************* //

    /**
     * @inheritdoc IENSManager
     */
    function isAvailable(bytes32 _subnode) public view override returns (bool) {
        bytes32 node = keccak256(abi.encodePacked(rootNode, _subnode));
        address currentOwner = ensRegistry.owner(node);
        if (currentOwner == address(0)) {
            return true;
        }
        return false;
    }

    function _getENSReverseRegistrar() internal view returns (address) {
        return ensRegistry.owner(ADDR_REVERSE_NODE);
    }
}
