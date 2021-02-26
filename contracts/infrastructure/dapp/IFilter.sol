pragma solidity ^0.6.12;

interface IFilter {
    function validate(address _spender, address _to, bytes calldata _data) external view returns (bool);
}