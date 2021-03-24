pragma solidity 0.7.5;


interface IUniswapProxy {
    function swapOnUniswap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path
    )
        external
        returns (uint256);

    function swapOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path
    )
        external
        returns (uint256);

    function buyOnUniswap(
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path
    )
        external
        returns (uint256 tokensSold);

    function buyOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path
    )
        external
        returns (uint256 tokensSold);

   function setupTokenSpender(address tokenSpender) external;

}
