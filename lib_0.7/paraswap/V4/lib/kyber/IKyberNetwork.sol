pragma solidity 0.7.5;

interface IKyberNetwork {
    function maxGasPrice() external view returns(uint);

    function tradeWithHintAndFee(
        address src,
        uint256 srcAmount,
        address dest,
        address payable destAddress,
        uint256 maxDestAmount,
        uint256 minConversionRate,
        address payable platformWallet,
        uint256 platformFeeBps,
        bytes calldata hint
    ) external payable returns (uint256 destAmount);
}
