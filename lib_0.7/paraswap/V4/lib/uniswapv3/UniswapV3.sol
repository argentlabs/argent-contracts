pragma solidity 0.7.5;
pragma abicoder v2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "../IExchange.sol";
import "../Utils.sol";
import "./ISwapRouterUniV3.sol";
import "../../IWETH.sol";

contract UniswapV3 is IExchange {

  struct UniswapV3Data {
    uint24 fee;
    uint256 deadline;
    uint160 sqrtPriceLimitX96;
  }


  function getKey() public override pure returns (bytes32) {
    return keccak256(abi.encodePacked("UniswapV3", "1.0.0"));
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

    UniswapV3Data memory data = abi.decode(payload, (UniswapV3Data));

    address _fromToken = address(fromToken) == Utils.ethAddress()
    ? Utils.wethAddress() : address(fromToken);
    address _toToken = address(toToken) == Utils.ethAddress()
    ? Utils.wethAddress() : address(toToken);

    if (address(fromToken) == Utils.ethAddress()) {
      IWETH(Utils.wethAddress()).deposit{value : fromAmount}();
    }

    Utils.approve(address(exchange), _fromToken, fromAmount);

    ISwapRouterUniV3(exchange).exactInputSingle(ISwapRouterUniV3.ExactInputSingleParams(
      {
      tokenIn : _fromToken,
      tokenOut : _toToken,
      fee : data.fee,
      recipient : address(this),
      deadline : data.deadline,
      amountIn : fromAmount,
      amountOutMinimum : toAmount,
      sqrtPriceLimitX96 : data.sqrtPriceLimitX96
      }
      )
    );

    if (address(toToken) == Utils.ethAddress()) {
      IWETH(Utils.wethAddress()).withdraw(
        IERC20(Utils.wethAddress()).balanceOf(address(this))
      );
    }

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

    UniswapV3Data memory data = abi.decode(payload, (UniswapV3Data));

    address _fromToken = address(fromToken) == Utils.ethAddress()
    ? Utils.wethAddress() : address(fromToken);
    address _toToken = address(toToken) == Utils.ethAddress()
    ? Utils.wethAddress() : address(toToken);

    if (address(fromToken) == Utils.ethAddress()) {
      IWETH(Utils.wethAddress()).deposit{value : fromAmount}();
    }

    Utils.approve(address(exchange), _fromToken, fromAmount);

    ISwapRouterUniV3(exchange).exactOutputSingle(ISwapRouterUniV3.ExactOutputSingleParams(
      {
      tokenIn : _fromToken,
      tokenOut : _toToken,
      fee : data.fee,
      recipient : address(this),
      deadline : data.deadline,
      amountOut : toAmount,
      amountInMaximum : fromAmount,
      sqrtPriceLimitX96 : data.sqrtPriceLimitX96
      }
      )
    );

    if (
      address(fromToken) == Utils.ethAddress() ||
      address(toToken) == Utils.ethAddress()
    ) {
      IWETH(Utils.wethAddress()).withdraw(
        IERC20(Utils.wethAddress()).balanceOf(address(this))
      );
    }

  }

  function initialize(bytes calldata data) external override {
    revert("METHOD NOT IMPLEMENTED");
  }

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
    revert("METHOD NOT SUPPORTED");
  }

}
