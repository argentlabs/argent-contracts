pragma solidity ^0.6.12;

interface IAuthoriser {
    function isAuthorised(address _wallet, address _spender, address _to, bytes calldata _data) external view returns (bool);
    function toggleRegistry(address _wallet, uint8 _registry, bool _enabled) external returns (bool);
}