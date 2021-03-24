pragma solidity 0.7.5;

interface IReduxToken {

    function freeUpTo(uint256 value) external returns (uint256 freed);

    function freeFromUpTo(address from, uint256 value) external returns (uint256 freed);

    function mint(uint256 value) external;
}
