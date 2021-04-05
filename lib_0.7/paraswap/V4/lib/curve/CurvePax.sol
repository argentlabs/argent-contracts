pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract CurvePax is IExchange {

    address public dai;
    address public usdc;
    address public usdt;
    address public pax;
    address public ycDAI;
    address public ycUSDC;
    address public ycUSDT;
    address public curvePAXExchange;

    constructor (
        address curvePAXExchange_,
        address dai_,
        address usdc_,
        address usdt_,
        address pax_,
        address ycDAI_,
        address ycUSDC_,
        address ycUSDT_
    )
        public
    {
        curvePAXExchange = curvePAXExchange_;
        dai = dai_;
        usdc = usdc_;
        usdt = usdt_;
        pax = pax_;
        ycDAI = ycDAI_;
        ycUSDC = ycUSDC_;
        ycUSDT = ycUSDT_;
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
          address(curvePAXExchange),
          address(fromToken), fromAmount
        );
        if (
            (address(fromToken) == ycDAI && address(toToken) == ycUSDC) || (address(fromToken) == ycDAI && address(toToken) == ycUSDT) || (address(fromToken) == ycDAI && address(toToken) == pax) ||
            (address(fromToken) == ycUSDC && address(toToken) == ycDAI) || (address(fromToken) == ycUSDC && address(toToken) == ycUSDT) || (address(fromToken) == ycUSDC && address(toToken) == pax) ||
            (address(fromToken) == ycUSDT && address(toToken) == ycDAI) || (address(fromToken) == ycUSDT && address(toToken) == ycUSDC) || (address(fromToken) == ycUSDT && address(toToken) == pax) ||
            (address(fromToken) == pax && address(toToken) == ycDAI) || (address(fromToken) == pax && address(toToken) == ycUSDC) || (address(fromToken) == pax && address(toToken) == ycUSDT)
        )
        {
            int128 i = address(fromToken) == ycDAI ? 0 : address(fromToken) == ycUSDC ? 1 : address(fromToken) == ycUSDT ? 2 : 3;
            int128 j = address(toToken) == ycDAI ? 0 : address(toToken) == ycUSDC ? 1 : address(toToken) == ycUSDT ? 2 : 3;

            ICurvePool(curvePAXExchange).exchange(
                i,
                j,
                fromAmount,
                1
            );
        }
        else if (
          (address(fromToken) == dai && address(toToken) == usdc) || (address(fromToken) == dai && address(toToken) == usdt) || (address(fromToken) == dai && address(toToken) == pax) ||
          (address(fromToken) == usdc && address(toToken) == dai) || (address(fromToken) == usdc && address(toToken) == usdt) || (address(fromToken) == usdc && address(toToken) == pax) ||
          (address(fromToken) == usdt && address(toToken) == dai) || (address(fromToken) == usdt && address(toToken) == usdc) || (address(fromToken) == usdt && address(toToken) == pax) ||
          (address(fromToken) == pax && address(toToken) == dai) || (address(fromToken) == pax && address(toToken) == usdc) || (address(fromToken) == pax && address(toToken) == usdc)
        )
        {
            int128 i = address(fromToken) == dai ? 0 : address(fromToken) == usdc ? 1 : address(fromToken) == usdt ? 2 : 3;
            int128 j = address(toToken) == dai ? 0 : address(toToken) == usdc ? 1 : address(toToken) == usdt ? 2 : 3;

            ICurvePool(curvePAXExchange).exchange_underlying(
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
        return keccak256(abi.encodePacked("CURVEPAX", "1.0.0"));
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }
}
