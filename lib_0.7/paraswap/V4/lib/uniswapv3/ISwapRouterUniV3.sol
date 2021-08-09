pragma solidity 0.7.5;
pragma abicoder v2;

interface ISwapRouterUniV3 {

  struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
  }

  struct ExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 amountInMaximum;
    uint160 sqrtPriceLimitX96;
  }

  function exactInputSingle(ExactInputSingleParams calldata params)
  external payable
  returns (uint256 amountOut);

  function exactOutputSingle(ExactOutputSingleParams calldata params)
  external payable returns (uint256 amountIn);

}
