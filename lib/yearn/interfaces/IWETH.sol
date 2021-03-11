// SPDX-License-Identifier: MIT

pragma solidity ^0.5.4;

interface IWETH {
    function deposit() external payable;
    function withdraw(uint wad) external;
    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);
}