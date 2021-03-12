pragma solidity ^0.5.4;


interface IContractRegistry {
    function addressOf(bytes32 _contractName) external view returns (address);

}