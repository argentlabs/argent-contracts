pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract CurveiEARNUSDB is IExchange {

    address public dai;
    address public usdc;
    address public usdt;
    address public busd;
    address public yDAIv3;
    address public yUSDCv3;
    address public yUSDTv3;
    address public yBUSD;
    address public curveiEarnUSDBExchange;

    constructor (
        address curveiEarnUSDBExchange_,
        address dai_,
        address usdc_,
        address usdt_,
        address busd_,
        address yDAIv3_,
        address yUSDCv3_,
        address yUSDTv3_,
        address yBUSD_
    )
        public
    {
        curveiEarnUSDBExchange = curveiEarnUSDBExchange_;
        dai = dai_;
        usdc = usdc_;
        usdt = usdt_;
        busd = busd_;
        yDAIv3 = yDAIv3_;
        yUSDCv3 = yUSDCv3_;
        yUSDTv3 = yUSDTv3_;
        yBUSD = yBUSD_;
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
          address(curveiEarnUSDBExchange),
          address(fromToken), fromAmount
        );
        if (
            (address(fromToken) == yDAIv3 && address(toToken) == yUSDCv3) || (address(fromToken) == yDAIv3 && address(toToken) == yUSDTv3) || (address(fromToken) == yDAIv3 && address(toToken) == yBUSD) ||
            (address(fromToken) == yUSDCv3 && address(toToken) == yDAIv3) || (address(fromToken) == yUSDCv3 && address(toToken) == yUSDTv3) || (address(fromToken) == yUSDCv3 && address(toToken) == yBUSD) ||
            (address(fromToken) == yUSDTv3 && address(toToken) == yDAIv3) || (address(fromToken) == yUSDTv3 && address(toToken) == yUSDCv3) || (address(fromToken) == yUSDTv3 && address(toToken) == yBUSD) ||
            (address(fromToken) == yBUSD && address(toToken) == yDAIv3) || (address(fromToken) == yBUSD && address(toToken) == yUSDCv3) || (address(fromToken) == yBUSD && address(toToken) == yUSDTv3)
        )
        {
            int128 i = address(fromToken) == yDAIv3 ? 0 : address(fromToken) == yUSDCv3 ? 1 : address(fromToken) == yUSDTv3 ? 2 : 3;
            int128 j = address(toToken) == yDAIv3 ? 0 : address(toToken) == yUSDCv3 ? 1 : address(toToken) == yUSDTv3 ? 2 : 3;

            ICurvePool(curveiEarnUSDBExchange).exchange(
                i,
                j,
                fromAmount,
                1
            );
        }
        else if (
          (address(fromToken) == dai && address(toToken) == usdc) || (address(fromToken) == dai && address(toToken) == usdt) || (address(fromToken) == dai && address(toToken) == busd) ||
          (address(fromToken) == usdc && address(toToken) == dai) || (address(fromToken) == usdc && address(toToken) == usdt) || (address(fromToken) == usdc && address(toToken) == busd) ||
          (address(fromToken) == usdt && address(toToken) == dai) || (address(fromToken) == usdt && address(toToken) == usdc) || (address(fromToken) == usdt && address(toToken) == busd) ||
          (address(fromToken) == busd && address(toToken) == dai) || (address(fromToken) == busd && address(toToken) == usdc) || (address(fromToken) == busd && address(toToken) == usdc)
        )
        {
            int128 i = address(fromToken) == dai ? 0 : address(fromToken) == usdc ? 1 : address(fromToken) == usdt ? 2 : 3;
            int128 j = address(toToken) == dai ? 0 : address(toToken) == usdc ? 1 : address(toToken) == usdt ? 2 : 3;

            ICurvePool(curveiEarnUSDBExchange).exchange_underlying(
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
        return keccak256(abi.encodePacked("CURVEIEARNUSDB", "1.0.0"));
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }
}
