pragma solidity ^0.5.4;

interface IKyberNetwork {
    function maxGasPrice() external view returns(uint);

    function trade(
        address src,
        uint srcAmount,
        address dest,
        address destAddress,
        uint maxDestAmount,
        uint minConversionRate,
        address walletId
    ) external payable returns (uint);
}
