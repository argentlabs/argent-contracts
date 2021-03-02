pragma solidity ^0.6.12;

interface IFilter {
    function isValid(address _wallet, address _spender, address _to, bytes calldata _data) external view returns (bool);
}