pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IUniswapRouter.sol";
import "../TokenFetcher.sol";


contract UniswapV2 is IExchange, TokenFetcher {
    using SafeMath for uint256;
    using Address for address;

    struct UniswapV2Data {
        address[] path;
    }

    address public weth;

    constructor(address _weth) public {
        weth = _weth;
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    * It will only allow contracts to send funds to it
    */
    function() external payable {
        address account = msg.sender;
        require(
            account.isContract(),
            "Sender is not a contract"
        );
    }

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload) external payable returns (uint256) {

        UniswapV2Data memory data = abi.decode(payload, (UniswapV2Data));

        Utils.approve(address(exchange), address(fromToken));

        if (address(fromToken) == Utils.ethAddress()) {
            require(
                data.path[0] == weth,
                "First element in path must be WETH"
            );

            require(
                data.path[data.path.length - 1] == address(toToken),
                "last element in path must be toToken"
            );

            IUniswapRouter(exchange).swapExactETHForTokens.value(fromAmount)(
                toAmount,
                data.path,
                address(this),
                now
            );
        }
        else if (address(toToken) == Utils.ethAddress()) {
            require(
                data.path[0] == address(fromToken),
                "First element in path must be fromToken"
            );

            require(
                data.path[data.path.length - 1] == weth,
                "last element in path must be weth"
            );
            IUniswapRouter(exchange).swapExactTokensForETH(
                fromAmount,
                toAmount,
                data.path,
                address(this),
                now
            );
        }
        else {
            require(
                data.path[0] == address(fromToken),
                "First element in path must be fromToken"
            );

            require(
                data.path[data.path.length - 1] == address(toToken),
                "last element in path must be toToken"
            );
            IUniswapRouter(exchange).swapExactTokensForTokens(
                fromAmount,
                toAmount,
                data.path,
                address(this),
                now
            );
        }

        uint256 receivedAmount = Utils.tokenBalance(
          address(toToken),
          address(this)
        );

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload) external payable returns (uint256) {

        UniswapV2Data memory data = abi.decode(payload, (UniswapV2Data));

        Utils.approve(address(exchange), address(fromToken));

        if (address(fromToken) == Utils.ethAddress()) {
            require(
                data.path[0] == weth,
                "First element in path must be WETH"
            );

            require(
                data.path[data.path.length - 1] == address(toToken),
                "last element in path must be toToken"
            );

            IUniswapRouter(exchange).swapETHForExactTokens.value(fromAmount)(
                toAmount,
                data.path,
                address(this),
                now
            );
        }
        else if (address(toToken) == Utils.ethAddress()) {
            require(
                data.path[0] == address(fromToken),
                "First element in path must be fromToken"
            );

            require(
                data.path[data.path.length - 1] == weth,
                "last element in path must be weth"
            );
            IUniswapRouter(exchange).swapTokensForExactETH(
                toAmount,
                fromAmount,
                data.path,
                address(this),
                now
            );
        }
        else {
            require(
                data.path[0] == address(fromToken),
                "First element in path must be fromToken"
            );

            require(
                data.path[data.path.length - 1] == address(toToken),
                "last element in path must be toToken"
            );
            IUniswapRouter(exchange).swapTokensForExactTokens(
                toAmount,
                fromAmount,
                data.path,
                address(this),
                now
            );
        }

        uint256 remainingAmount = Utils.tokenBalance(
          address(fromToken),
          address(this)
        );
        uint256 receivedAmount = Utils.tokenBalance(
          address(toToken),
          address(this)
        );

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);
        Utils.transferTokens(address(fromToken), msg.sender, remainingAmount);

        return receivedAmount;
    }
}

