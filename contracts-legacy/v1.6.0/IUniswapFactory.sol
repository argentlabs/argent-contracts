pragma solidity ^0.5.4;

interface IUniswapFactory {
    function getExchange(address _token) external view returns(address);
}