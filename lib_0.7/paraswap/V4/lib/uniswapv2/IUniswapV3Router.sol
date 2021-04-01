pragma solidity 0.7.5;


interface IUniswapV3Router {

    function swap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path
    ) external payable returns (uint256 tokensBought);

    function buy(
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path
    ) external payable returns (uint256 tokensSold);

}
