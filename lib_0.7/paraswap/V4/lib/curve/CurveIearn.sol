pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract CurveIearn is IExchange {

    address public dai;
    address public usdc;
    address public usdt;
    address public tusd;
    address public yDAI;
    address public yUSDC;
    address public yUSDT;
    address public yTUSD;
    address public curveIearnExchange;

    constructor (
        address curveIearnExchange_,
        address dai_,
        address usdc_,
        address usdt_,
        address tusd_,
        address yDAI_,
        address yUSDC_,
        address yUSDT_,
        address yTUSD_
    )
        public
    {
        curveIearnExchange = curveIearnExchange_;
        dai = dai_;
        usdc = usdc_;
        usdt = usdt_;
        tusd = tusd_;
        yDAI = yDAI_;
        yUSDC = yUSDC_;
        yUSDT = yUSDT_;
        yTUSD = yTUSD_;
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
          address(curveIearnExchange),
          address(fromToken), fromAmount
        );
        if (
            (address(fromToken) == yDAI && address(toToken) == yUSDC) || (address(fromToken) == yDAI && address(toToken) == yUSDT) || (address(fromToken) == yDAI && address(toToken) == yTUSD) ||
            (address(fromToken) == yUSDC && address(toToken) == yDAI) || (address(fromToken) == yUSDC && address(toToken) == yUSDT) || (address(fromToken) == yUSDC && address(toToken) == yTUSD) ||
            (address(fromToken) == yUSDT && address(toToken) == yDAI) || (address(fromToken) == yUSDT && address(toToken) == yUSDC) || (address(fromToken) == yUSDT && address(toToken) == yTUSD) ||
            (address(fromToken) == yTUSD && address(toToken) == yDAI) || (address(fromToken) == yTUSD && address(toToken) == yUSDC) || (address(fromToken) == yTUSD && address(toToken) == yUSDT)
        )
        {
            int128 i = address(fromToken) == yDAI ? 0 : address(fromToken) == yUSDC ? 1 : address(fromToken) == yUSDT ? 2 : 3;
            int128 j = address(toToken) == yDAI ? 0 : address(toToken) == yUSDC ? 1 : address(toToken) == yUSDT ? 2 : 3;

            ICurvePool(curveIearnExchange).exchange(
                i,
                j,
                fromAmount,
                1
            );
        }
        else if (
          (address(fromToken) == dai && address(toToken) == usdc) || (address(fromToken) == dai && address(toToken) == usdt) || (address(fromToken) == dai && address(toToken) == tusd) ||
          (address(fromToken) == usdc && address(toToken) == dai) || (address(fromToken) == usdc && address(toToken) == usdt) || (address(fromToken) == usdc && address(toToken) == tusd) ||
          (address(fromToken) == usdt && address(toToken) == dai) || (address(fromToken) == usdt && address(toToken) == usdc) || (address(fromToken) == usdt && address(toToken) == tusd) ||
          (address(fromToken) == tusd && address(toToken) == dai) || (address(fromToken) == tusd && address(toToken) == usdc) || (address(fromToken) == tusd && address(toToken) == usdc)
        )
        {
            int128 i = address(fromToken) == dai ? 0 : address(fromToken) == usdc ? 1 : address(fromToken) == usdt ? 2 : 3;
            int128 j = address(toToken) == dai ? 0 : address(toToken) == usdc ? 1 : address(toToken) == usdt ? 2 : 3;

            ICurvePool(curveIearnExchange).exchange_underlying(
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
        return keccak256(abi.encodePacked("CURVEIEARN", "1.0.0"));
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }
}
