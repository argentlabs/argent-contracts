pragma solidity ^0.5.4;


interface IProxyRegistry {

    function proxies(address account) external view returns(address);
}