// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

abstract contract TestCdpManager {
    function urns(uint) public virtual view returns (address);
    function open(bytes32, address) public virtual returns (uint);
    function frob(uint, int, int) public virtual;
    function give(uint, address) public virtual;
    function move(uint, address, uint) public virtual;
    function flux(uint, address, uint) public virtual;
    mapping (uint => bytes32) public ilks;

    event NewCdp(address indexed usr, address indexed own, uint indexed cdp);
}