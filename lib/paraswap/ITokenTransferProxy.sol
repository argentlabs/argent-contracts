pragma solidity ^0.5.4;


interface ITokenTransferProxy {

    function transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    )
        external;

    function freeGSTTokens(uint256 tokensToFree) external;
}