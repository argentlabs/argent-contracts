pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "./LibOrderV2.sol";


interface IZeroxV2 {

    function marketSellOrdersNoThrow(
        LibOrderV2.Order[] calldata orders,
        uint256 takerAssetFillAmount,
        bytes[] calldata signatures
    )
        external
        returns(LibOrderV2.FillResults memory);
}
