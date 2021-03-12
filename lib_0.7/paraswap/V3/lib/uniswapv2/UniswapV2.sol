pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IUniswapV3Router.sol";
import "../TokenFetcher.sol";


contract UniswapV2 is IExchange, TokenFetcher {
    using SafeMath for uint256;
    using Address for address;

    struct UniswapV2Data {
        address[] path;
    }

    address public weth;

    address public uinswapV2Router;

    constructor(address _weth, address uinswapV2Router_) public {
        weth = _weth;
        uinswapV2Router = uinswapV2Router_;
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    */
    receive() external payable {
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
        override
        payable
        returns (uint256)
    {

        UniswapV2Data memory data = abi.decode(payload, (UniswapV2Data));
        return _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            exchange,
            data.path
        );

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
        override
        payable
        returns (uint256)
    {

        UniswapV2Data memory data = abi.decode(payload, (UniswapV2Data));

        uint256 value = 0;

        if (address(fromToken) == Utils.ethAddress()) {
          value = fromAmount;
        }
        else {
            Utils.approve(address(exchange), address(fromToken), fromAmount);
        }

        IUniswapV3Router(exchange).buy{value: value}(
            fromAmount,
            toAmount,
            data.path
        );

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

    //PATH Token -> Token
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

        address[] memory path = new address[](2);

        path[0] = address(fromToken);
        path[1] = address(toToken);

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

        uint256 value = 0;

        if (address(fromToken) == Utils.ethAddress()) {
            value = fromAmount;
        }
        else {
            Utils.approve(address(exchange), address(fromToken), fromAmount);
        }

        IUniswapV3Router(exchange).swap{value: value}(
            fromAmount,
            toAmount,
            path
        );

        uint256 receivedAmount = Utils.tokenBalance(
          address(toToken),
          address(this)
        );

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}

