pragma solidity ^0.6.8;

contract TestCdpManager {
    function urns(uint) public view returns (address);
    function open(bytes32, address) public returns (uint);
    function frob(uint, int, int) public;
    function give(uint, address) public;
    function move(uint, address, uint) public;
    function flux(uint, address, uint) public;
    mapping (uint => bytes32) public ilks;

    event NewCdp(address indexed usr, address indexed own, uint indexed cdp);
}