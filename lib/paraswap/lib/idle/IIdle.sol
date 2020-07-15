pragma solidity ^0.5.4;


interface IIdle {

    function redeemIdleToken(
        uint256 amount,
        bool skipRebalance,
        uint256[] calldata clientProtocolAmounts
    )
        external
        returns(uint256);

    function mintIdleToken(
        uint256 amount,
        uint256[] calldata clientProtocolAmounts
    )
        external
        returns(uint256);

    function token() external view returns(address);
}