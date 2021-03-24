pragma solidity 0.7.5;


interface ITokenTransferProxy {

    function transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    )
        external;

    function freeReduxTokens(address user, uint256 tokensToFree) external;
}
