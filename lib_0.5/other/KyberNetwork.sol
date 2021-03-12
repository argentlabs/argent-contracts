pragma solidity >=0.5.4 <0.7.0;
import "./ERC20.sol";

interface KyberNetwork {

    function getExpectedRate(
        ERC20 src,
        ERC20 dest,
        uint srcQty
    )
        external
        view
        returns (uint expectedRate, uint slippageRate);

    function trade(
        ERC20 src,
        uint srcAmount,
        ERC20 dest,
        address payable destAddress,
        uint maxDestAmount,
        uint minConversionRate,
        address walletId
    )
        external
        payable
        returns(uint);
}
