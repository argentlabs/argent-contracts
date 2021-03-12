pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IUniswapExchange.sol";
import "./IUniswapFactory.sol";
import "../TokenFetcher.sol";


contract Uniswap is IExchange, TokenFetcher {
    using SafeMath for uint256;
    using Address for address;

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
        address factoryAddress,
        bytes calldata payload) external payable returns (uint256) {

        address exchange = getExchange(fromToken, toToken, factoryAddress);

        Utils.approve(address(exchange), address(fromToken));

        uint256 receivedAmount = 0;

        if (address(fromToken) == Utils.ethAddress()) {
            receivedAmount = IUniswapExchange(exchange).ethToTokenSwapInput.value(fromAmount)(toAmount, now);
        }
        else if (address(toToken) == Utils.ethAddress()) {
            receivedAmount = IUniswapExchange(exchange).tokenToEthSwapInput(fromAmount, toAmount, now);
        }
        else {
            receivedAmount = IUniswapExchange(exchange).tokenToTokenSwapInput(fromAmount, toAmount, 1, now, address(toToken));
        }

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address factoryAddress,
        bytes calldata payload) external payable returns (uint256) {

        address exchange = getExchange(fromToken, toToken, factoryAddress);

        Utils.approve(address(exchange), address(fromToken));

        if (address(fromToken) == Utils.ethAddress()) {
            IUniswapExchange(exchange).ethToTokenSwapOutput.value(fromAmount)(toAmount, now);
        }
        else if (address(toToken) == Utils.ethAddress()) {
            IUniswapExchange(exchange).tokenToEthSwapOutput(toAmount, fromAmount, now);
        }
        else {
            IUniswapExchange(exchange).tokenToTokenSwapOutput(
              toAmount,
              fromAmount,
              Utils.maxUint(),
              now,
              address(toToken)
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

    function getExchange(
        IERC20 fromToken,
        IERC20 toToken,
        address factoryAddress
    )
      private
      view
      returns (address)
    {
        address exchangeAddress = address(fromToken) == Utils.ethAddress() ? address(toToken) : address(fromToken);

        return IUniswapFactory(factoryAddress).getExchange(exchangeAddress);
    }
}

