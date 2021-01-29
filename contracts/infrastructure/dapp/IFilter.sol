pragma solidity ^0.6.12;

interface IFilter {
    function validate(bytes calldata _data) external view returns (bool);
}