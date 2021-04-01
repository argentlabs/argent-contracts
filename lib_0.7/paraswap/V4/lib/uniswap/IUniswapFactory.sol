pragma solidity 0.7.5;

import "./IUniswapExchange.sol";

interface IUniswapFactory {
    function getExchange(address token) external view returns (address exchange);
}
