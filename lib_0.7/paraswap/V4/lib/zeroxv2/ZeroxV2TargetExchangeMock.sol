pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "./IZeroxV2.sol";

contract ZeroxV2TargetExchangeMock is IZeroxV2 {

    function marketSellOrdersNoThrow(
        LibOrderV2.Order[] calldata orders,
        uint256 takerAssetFillAmount,
        bytes[] calldata signatures
    )
        external
        override
        returns(LibOrderV2.FillResults memory)
    {
        // empty mock
    }

    function unauthorisedMethod() external {}
}