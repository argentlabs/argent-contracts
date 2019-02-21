pragma solidity ^0.5.4;

/**
 * ENS Registry interface.
 */
contract ENSRegistry {
    function owner(bytes32 _node) public view returns (address);
    function resolver(bytes32 _node) public view returns (address);
    function ttl(bytes32 _node) public view returns (uint64);
    function setOwner(bytes32 _node, address _owner) public;
    function setSubnodeOwner(bytes32 _node, bytes32 _label, address _owner) public;
    function setResolver(bytes32 _node, address _resolver) public;
    function setTTL(bytes32 _node, uint64 _ttl) public;
}

/**
 * ENS Resolver interface.
 */
contract ENSResolver {
    function addr(bytes32 _node) public view returns (address);
    function setAddr(bytes32 _node, address _addr) public;
    function name(bytes32 _node) public view returns (string memory);
    function setName(bytes32 _node, string memory _name) public;
}

/**
 * ENS Reverse Registrar interface.
 */
contract ENSReverseRegistrar {
    function claim(address _owner) public returns (bytes32 _node);
    function claimWithResolver(address _owner, address _resolver) public returns (bytes32);
    function setName(string memory _name) public returns (bytes32);
    function node(address _addr) public returns (bytes32);
}