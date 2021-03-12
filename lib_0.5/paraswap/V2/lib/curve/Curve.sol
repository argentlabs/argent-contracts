pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract Curve is IExchange, TokenFetcher {
    using Address for address;

    struct CurveData {
        int128 i;
        int128 j;
        uint256 deadline;
        bool underlyingSwap;
    }

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload) external payable returns (uint256) {

        CurveData memory curveData = abi.decode(payload, (CurveData));

        Utils.approve(address(exchange), address(fromToken));

        if (curveData.underlyingSwap) {
            require(
                IPool(exchange).underlying_coins(curveData.i) == address(fromToken),
                "Invalid from token"
            );
            require(
                IPool(exchange).underlying_coins(curveData.j) == address(toToken),
                "Invalid to token"
            );
            ICurvePool(exchange).exchange_underlying(curveData.i, curveData.j, fromAmount, toAmount);
        }
        else {
            require(
                IPool(exchange).coins(curveData.i) == address(fromToken),
                "Invalid from token"
            );
            require(
                IPool(exchange).coins(curveData.j) == address(toToken),
                "Invalid to token"
            );
            ICurvePool(exchange).exchange(curveData.i, curveData.j, fromAmount, toAmount);
        }



        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload
    )
        external
        payable
        returns (uint256)
    {
        revert("METHOD NOT SUPPORTED");

    }
}
