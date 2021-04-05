pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IUniswapExchange.sol";
import "./IUniswapFactory.sol";

import "../../AdapterStorage.sol";


contract UniswapOnchain is IExchange, AdapterStorage {
    using SafeMath for uint256;

    address public factory;

    constructor(address _factory) public {
      factory = _factory;
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    */
    receive() external payable {
    }


    function initialize(bytes calldata data) external override {
       revert("METHOD NOT SUPPORTED");
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
        revert("METHOD NOT SUPPORTED");
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
        revert("METHOD NOT SUPPORTED");
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

        return _swap(
            factory,
            fromToken,
            toToken,
            fromAmount,
            toAmount
        );
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("UNISWAPONCHAIN", "1.0.0"));
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

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

}

