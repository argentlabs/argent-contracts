// SPDX-License-Identifier: MIT

pragma solidity ^0.7.5;

interface IConverter {
    function convert(address) external returns (uint256);
}