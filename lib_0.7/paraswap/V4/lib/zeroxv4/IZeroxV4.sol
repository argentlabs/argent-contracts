pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "./LibOrderV4.sol";


interface IZeroxV4 {

    function fillRfqOrder(
        // The order
        LibOrderV4.Order calldata order,
        // The signature
        LibOrderV4.Signature calldata signature,
        // How much taker token to fill the order with
        uint128 takerTokenFillAmount
    )
        external
        payable
        // How much maker token from the order the taker received.
        returns (uint128, uint128);
}
