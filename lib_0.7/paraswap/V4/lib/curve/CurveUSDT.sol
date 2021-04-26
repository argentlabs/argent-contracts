pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract CurveUSDT is IExchange {

    address public dai;
    address public usdc;
    address public usdt;
    address public cDAI;
    address public cUSDC;
    address public cUSDT;
    address public curveUSDTExchange;

    constructor (
        address curveUSDTExchange_,
        address dai_,
        address usdc_,
        address usdt_,
        address cDAI_,
        address cUSDC_,
        address cUSDT_
    )
        public
    {
        curveUSDTExchange = curveUSDTExchange_;
        dai = dai_;
        usdc = usdc_;
        usdt = usdt_;
        cDAI = cDAI_;
        cUSDC = cUSDC_;
        cUSDT = cUSDT_;
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
          address(curveUSDTExchange),
          address(fromToken), fromAmount
        );
        if (
            (address(fromToken) == cDAI && address(toToken) == cUSDC) || (address(fromToken) == cDAI && address(toToken) == cUSDT) ||
            (address(fromToken) == cUSDC && address(toToken) == cDAI) || (address(fromToken) == cUSDC && address(toToken) == cUSDT) ||
            (address(fromToken) == cUSDT && address(toToken) == cDAI) || (address(fromToken) == cUSDT && address(toToken) == cUSDC)
        )
        {
            int128 i = address(fromToken) == cDAI ? 0 : address(fromToken) == cUSDC ? 1 : 2;
            int128 j = address(toToken) == cDAI ? 0 : address(toToken) == cUSDC ? 1 : 2;

            ICurvePool(curveUSDTExchange).exchange(
                i,
                j,
                fromAmount,
                1
            );
        }
        else if (
          (address(fromToken) == dai && address(toToken) == usdc) || (address(fromToken) == dai && address(toToken) == usdt) ||
          (address(fromToken) == usdc && address(toToken) == dai) || (address(fromToken) == usdc && address(toToken) == usdt) ||
          (address(fromToken) == usdt && address(toToken) == dai) || (address(fromToken) == usdt && address(toToken) == usdc)
        )
        {
            int128 i = address(fromToken) == dai ? 0 : address(fromToken) == usdc ? 1 : 2;
            int128 j = address(toToken) == dai ? 0 : address(toToken) == usdc ? 1 : 2;

            ICurvePool(curveUSDTExchange).exchange_underlying(
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
        return keccak256(abi.encodePacked("CURVEUSDT", "1.0.0"));
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }
}
