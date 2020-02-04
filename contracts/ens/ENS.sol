pragma solidity ^0.5.4;

/**
 * ENS Registry interface.
 * Reference: https://github.com/ensdomains/ens/blob/master/contracts/ENS.sol
 */
interface ENSRegistry {

    // Logged when the owner of a node assigns a new owner to a subnode.
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);

    // Logged when the owner of a node transfers ownership to a new account.
    event Transfer(bytes32 indexed node, address owner);

    // Logged when the resolver for a node changes.
    event NewResolver(bytes32 indexed node, address resolver);

    // Logged when the TTL of a node changes
    event NewTTL(bytes32 indexed node, uint64 ttl);

    function setRecord(bytes32 node, address owner, address resolver, uint64 ttl) external;
    function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl) external;
    function setSubnodeOwner(bytes32 node, bytes32 label, address owner) external returns(bytes32);
    function setResolver(bytes32 node, address resolver) external;
    function setOwner(bytes32 node, address owner) external;
    function setTTL(bytes32 node, uint64 ttl) external;
    function owner(bytes32 node) external view returns (address);
    function resolver(bytes32 node) external view returns (address);
    function ttl(bytes32 node) external view returns (uint64);
    function recordExists(bytes32 node) external view returns (bool);
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