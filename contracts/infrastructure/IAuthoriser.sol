pragma solidity ^0.6.12;

interface IAuthoriser {
    function authorise(address _wallet, address _contract, bytes calldata _data) external view returns (bool) ;
}