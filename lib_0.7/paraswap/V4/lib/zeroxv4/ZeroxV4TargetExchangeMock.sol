pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "./IZeroxV4.sol";

contract ZeroxV4TargetExchangeMock is IZeroxV4 {

    function fillRfqOrder(
        // The order
        LibOrderV4.Order calldata order,
        // The signature
        LibOrderV4.Signature calldata signature,
        // How much taker token to fill the order with
        uint128 takerTokenFillAmount
    )
        external
        override
        payable
        // How much maker token from the order the taker received.
        returns (uint128, uint128) 
    {
        // empty mock
    }
}