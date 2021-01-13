// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.4;

interface IUniswapFactory {
    function getExchange(address _token) external view returns(address);
}