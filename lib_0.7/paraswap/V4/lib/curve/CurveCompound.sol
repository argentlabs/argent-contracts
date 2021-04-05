pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract Curve3Compound is IExchange {

    address public dai;
    address public usdc;
    address public cDAI;
    address public cUSDC;
    address public curveCompoundExchange;

    constructor (
        address curveCompoundExchange_,
        address dai_,
        address usdc_,
        address cDAI_,
        address cUSDC_
    )
    public
    {
        curveCompoundExchange = curveCompoundExchange_;
        dai = dai_;
        usdc = usdc_;
        cDAI = cDAI_;
        cUSDC = cUSDC_;
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
          address(curveCompoundExchange),
          address(fromToken), fromAmount
        );
        if (
          (address(fromToken) == cDAI && address(toToken) == cUSDC) || (address(fromToken) == cUSDC && address(toToken) == cDAI)
        )
        {
            int128 i = address(fromToken) == cDAI ? 0 : 1;
            int128 j = address(toToken) == cDAI ? 0 : 1;

            ICurvePool(curveCompoundExchange).exchange(
              i,
              j,
              fromAmount,
              1
            );
        }
        else if (
          (address(fromToken) == dai && address(toToken) == usdc) || (address(fromToken) == usdc && address(toToken) == dai)
        )
        {
            int128 i = address(fromToken) == dai ? 0 : 1;
            int128 j = address(toToken) == dai ? 0 : 1;

            ICurvePool(curveCompoundExchange).exchange_underlying(
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
        return keccak256(abi.encodePacked("CURVECOMPOUND", "1.0.0"));
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }
}
