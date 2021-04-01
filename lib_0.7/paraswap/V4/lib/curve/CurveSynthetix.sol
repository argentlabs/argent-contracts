pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract CurveSynthetix is IExchange {

    address public dai;
    address public usdc;
    address public usdt;
    address public susd;
    address public curveSynthetixExchange;

    constructor (
        address curveSynthetixExchange_,
        address dai_,
        address usdc_,
        address usdt_,
        address susd_
    )
        public
    {
        curveSynthetixExchange = curveSynthetixExchange_;
        dai = dai_;
        usdc = usdc_;
        usdt = usdt_;
        susd = susd_;
    }

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload
    )
        external
        payable
        override

    {

        revert("METHOD NOT IMPLEMENTED");
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
        override

    {
        revert("METHOD NOT SUPPORTED");

    }

    //Swap on Curve Compound
    function onChainSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount
    )
        external
        override
        payable
        returns (uint256)
    {
        Utils.approve(
          address(curveSynthetixExchange),
          address(fromToken), fromAmount
        );
        if (
          (address(fromToken) == dai && address(toToken) == usdc) || (address(fromToken) == dai && address(toToken) == usdt) || (address(fromToken) == dai && address(toToken) == susd) ||
          (address(fromToken) == usdc && address(toToken) == dai) || (address(fromToken) == usdc && address(toToken) == usdt) || (address(fromToken) == usdc && address(toToken) == susd) ||
          (address(fromToken) == usdt && address(toToken) == dai) || (address(fromToken) == usdt && address(toToken) == usdc) || (address(fromToken) == usdt && address(toToken) == susd) ||
          (address(fromToken) == susd && address(toToken) == dai) || (address(fromToken) == susd && address(toToken) == usdc) || (address(fromToken) == susd && address(toToken) == usdc)
        )
        {
            int128 i = address(fromToken) == dai ? 0 : address(fromToken) == usdc ? 1 : address(fromToken) == usdt ? 2 : 3;
            int128 j = address(toToken) == dai ? 0 : address(toToken) == usdc ? 1 : address(toToken) == usdt ? 2 : 3;

            ICurvePool(curveSynthetixExchange).exchange_underlying(
                i,
                j,
                fromAmount,
                1
            );
        }
        else {
            revert("TOKEN NOT SUPPORTED");
        }

        uint256 receivedAmount = Utils.tokenBalance(
          address(toToken),
          address(this)
        );

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("CURVESYNTHETIX", "1.0.0"));
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }
}
