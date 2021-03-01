pragma solidity ^0.6.12;

interface IAuthoriser {
    function isAuthorised(address _sender, address _spender, address _to, bytes calldata _data) external view returns (bool);
}