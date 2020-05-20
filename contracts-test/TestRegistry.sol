// Source https://github.com/christianlundkvist/simple-multisig/blob/master/contracts/TestRegistry.sol
pragma solidity ^0.6.8;

// This contract is only used for testing the MultiSigWallet
contract TestRegistry {

  mapping(address => uint) public registry;

  function register(uint x) payable public {
    registry[msg.sender] = x;
  }
}