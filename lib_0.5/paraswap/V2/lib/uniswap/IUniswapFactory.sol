pragma solidity ^0.5.4;

import "./IUniswapExchange.sol";

interface IUniswapFactory {
    function getExchange(address token) external view returns (address exchange);
}
