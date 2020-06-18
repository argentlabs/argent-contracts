pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./IProxyRegistry.sol";
import "./IOasisExchange.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract Oasis is IExchange, TokenFetcher {
    using Address for address;

    struct OasisData {
        address otc;
        address weth;
        address factory;
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
        bytes calldata payload
    )
        external
        payable
        returns (uint256)
    {

        OasisData memory data = abi.decode(payload, (OasisData));

        Utils.approve(address(exchange), address(fromToken));

        address proxy = IProxyRegistry(data.factory).proxies(address(this));

        if (address(fromToken) == Utils.ethAddress()) {
            if (proxy == address(0)) {
                IOasisExchange(exchange).createAndSellAllAmountPayEth.value(fromAmount)(
                    data.factory,
                    data.otc,
                    address(toToken),
                    toAmount
                );
            }
            else {
                IOasisExchange(exchange).sellAllAmountPayEth.value(fromAmount)(
                    data.otc,
                    data.weth,
                    address(toToken),
                    toAmount
                );
            }
        }
        else if (address(toToken) == Utils.ethAddress()) {
            if (proxy == address(0)) {
                IOasisExchange(exchange).createAndSellAllAmountBuyEth(
                    data.factory,
                    data.otc,
                    address(fromToken),
                    fromAmount,
                    toAmount
                );
            }
            else {
                IOasisExchange(exchange).sellAllAmountBuyEth(
                    data.otc,
                    address(fromToken),
                    fromAmount,
                    data.weth,
                    toAmount
                );
            }
        }
        else {
            if (proxy == address(0)) {
                IOasisExchange(exchange).createAndSellAllAmount(
                    data.factory,
                    data.otc,
                    address(fromToken),
                    fromAmount,
                    address(toToken),
                    toAmount
                );
            }
            else {
                IOasisExchange(exchange).sellAllAmount(
                    data.otc,
                    address(fromToken),
                    fromAmount,
                    address(toToken),
                    toAmount
                );
            }
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
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
        returns (uint256)
    {

        OasisData memory data = abi.decode(payload, (OasisData));

        Utils.approve(address(exchange), address(fromToken));

        address proxy = IProxyRegistry(data.factory).proxies(address(this));

        if (address(fromToken) == Utils.ethAddress()) {
            if (proxy == address(0)) {
                IOasisExchange(exchange).createAndBuyAllAmountPayEth.value(fromAmount)(
                    data.factory,
                    data.otc,
                    address(toToken),
                    toAmount
                );
            }
            else {
                IOasisExchange(exchange).buyAllAmountPayEth.value(fromAmount)(
                    data.otc,
                    address(toToken),
                    toAmount,
                    data.weth
                );
            }
        }
        else if (address(toToken) == Utils.ethAddress()) {
            if (proxy == address(0)) {
                IOasisExchange(exchange).createAndBuyAllAmountBuyEth(
                    data.factory,
                    data.otc,
                    toAmount,
                    address(fromToken),
                    fromAmount
                );
            }
            else {
                IOasisExchange(exchange).buyAllAmountBuyEth(
                    data.otc,
                    data.weth,
                    toAmount,
                    address(fromToken),
                    fromAmount
                );
            }
        }
        else {
            if (proxy == address(0)) {
                IOasisExchange(exchange).createAndBuyAllAmount(
                    data.factory,
                    data.otc,
                    address(toToken),
                    toAmount,
                    address(fromToken),
                    fromAmount
                );
            }
            else {
                IOasisExchange(exchange).buyAllAmount(
                    data.otc,
                    address(toToken),
                    toAmount,
                    address(fromToken),
                    fromAmount
                );
            }
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
