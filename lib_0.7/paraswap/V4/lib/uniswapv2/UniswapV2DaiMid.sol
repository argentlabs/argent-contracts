pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IUniswapRouter.sol";



contract UniswapV2DaiMid is IExchange {
    using SafeMath for uint256;

    struct UniswapV2Data {
        address[] path;
    }

    address public weth;

    address public dai;

    address public uinswapV2Router;

    constructor(address _weth, address uinswapV2Router_, address dai_) public {
        weth = _weth;
        uinswapV2Router = uinswapV2Router_;
        dai = dai_;
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    */
    receive() external payable {
    }

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("UNISWAPV2DAIMID", "1.0.0"));
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

        revert("METHOD NOT SUPPORTED");

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

    //PATH Token -> WETH -> Token
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

        address[] memory path = new address[](3);
        path[0] = address(fromToken) == Utils.ethAddress() ? weth : address(fromToken);
        path[1] = dai;
        path[2] = address(toToken) == Utils.ethAddress() ? weth : address(toToken);

        return _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            uinswapV2Router,
            path
        );


    }

    function _swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        address[] memory path
    )
        private
        returns(uint256)
    {
        Utils.approve(address(exchange), address(fromToken), fromAmount);

        if (address(fromToken) == Utils.ethAddress()) {
            require(
                path[0] == weth,
                "First element in path must be WETH"
            );

            require(
                path[path.length - 1] == address(toToken),
                "last element in path must be toToken"
            );

            IUniswapRouter(exchange).swapExactETHForTokens{value: fromAmount}(
                toAmount,
                path,
                address(this),
                block.timestamp
            );
        }
        else if (address(toToken) == Utils.ethAddress()) {
            require(
                path[0] == address(fromToken),
                "First element in path must be fromToken"
            );

            require(
                path[path.length - 1] == weth,
                "last element in path must be weth"
            );
            IUniswapRouter(exchange).swapExactTokensForETH(
                fromAmount,
                toAmount,
                path,
                address(this),
                block.timestamp
            );
        }
        else {
            require(
                path[0] == address(fromToken),
                "First element in path must be fromToken"
            );

            require(
                path[path.length - 1] == address(toToken),
                "last element in path must be toToken"
            );
            IUniswapRouter(exchange).swapExactTokensForTokens(
                fromAmount,
                toAmount,
                path,
                address(this),
                block.timestamp
            );
        }

        uint256 receivedAmount = Utils.tokenBalance(
          address(toToken),
          address(this)
        );

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}

