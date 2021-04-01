pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IUniswapExchange.sol";
import "./IUniswapFactory.sol";

import "../../AdapterStorage.sol";


contract Uniswap is IExchange, AdapterStorage {
    using SafeMath for uint256;

    struct LocalData {
      address factory;
    }

    function initialize(bytes calldata data) external override {
       bytes32 key = getKey();
       require(!adapterInitialized[key], "Adapter already initialized");
       abi.decode(data, (LocalData));
       adapterInitialized[key] = true;
       adapterVsData[key] = data;
    }

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address factoryAddress,
        bytes calldata payload
    )
        external
        payable
        override

    {

        _swap(
            factoryAddress,
            fromToken,
            toToken,
            fromAmount,
            toAmount
        );
    }

    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address factoryAddress,
        bytes calldata payload
    )
        external
        payable
        override

    {

        address exchange = getExchange(fromToken, toToken, factoryAddress);

        Utils.approve(address(exchange), address(fromToken), fromAmount);

        if (address(fromToken) == Utils.ethAddress()) {
            IUniswapExchange(exchange).ethToTokenSwapOutput{value: fromAmount}(toAmount, block.timestamp);
        }
        else if (address(toToken) == Utils.ethAddress()) {
            IUniswapExchange(exchange).tokenToEthSwapOutput(toAmount, fromAmount, block.timestamp);
        }
        else {
            IUniswapExchange(exchange).tokenToTokenSwapOutput(
              toAmount,
              fromAmount,
              Utils.maxUint(),
              block.timestamp,
              address(toToken)
            );
        }

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
        bytes32 key = getKey();
        bytes memory localData = adapterVsData[key];
        LocalData memory lData = abi.decode(localData, (LocalData));

        return _swap(
            lData.factory,
            fromToken,
            toToken,
            fromAmount,
            toAmount
        );
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("UNISWAP", "1.0.0"));
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

    function _swap(
        address factoryAddress,
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount
    )
      private
      returns(uint256)
    {
        address exchange = getExchange(fromToken, toToken, factoryAddress);

        Utils.approve(
          exchange,
          address(fromToken),
          fromAmount
        );

        uint256 receivedAmount = 0;

        if (address(fromToken) == Utils.ethAddress()) {
            receivedAmount = IUniswapExchange(exchange).ethToTokenSwapInput{value: fromAmount}(toAmount, block.timestamp);
        }
        else if (address(toToken) == Utils.ethAddress()) {
            receivedAmount = IUniswapExchange(exchange).tokenToEthSwapInput(fromAmount, toAmount, block.timestamp);
        }
        else {
            receivedAmount = IUniswapExchange(exchange).tokenToTokenSwapInput(fromAmount, toAmount, 1, block.timestamp, address(toToken));
        }

        return receivedAmount;
    }

}

