// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.5.4;

interface IUniswapFactory {
    function getExchange(address _token) external view returns(address);
}