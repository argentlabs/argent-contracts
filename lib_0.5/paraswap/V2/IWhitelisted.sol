pragma solidity ^0.5.4;


interface IWhitelisted {

    function isWhitelisted(address account) external view returns (bool);
}