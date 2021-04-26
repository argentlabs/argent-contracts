pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../../IWETH.sol";
import "./IZeroxV4.sol";
import "./LibOrderV4.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../../AdapterStorage.sol";


contract ZeroxV4 is IExchange, AdapterStorage {

    struct ZeroxData {
        LibOrderV4.Order order;
        LibOrderV4.Signature signature;
    }

    // No LocalData for this adapter

    function initialize(bytes calldata data) external override {
        bytes32 key = getKey();
        require(!adapterInitialized[key], "Adapter already initialized");
        //abi.decode(data, (LocalData));
        adapterInitialized[key] = true;
        adapterVsData[key] = data;
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
        if (address(fromToken) == Utils.ethAddress()) {
            IWETH(Utils.wethAddress()).deposit{value: fromAmount}();
        }

        _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            exchange,
            payload
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
        payable
        override
    {
        if (address(fromToken) == Utils.ethAddress()) {
            IWETH(Utils.wethAddress()).deposit{value: fromAmount}();
        }

        _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            exchange,
            payload
        );

        if (address(fromToken) == Utils.ethAddress()) {
            uint256 remainingAmount = Utils.tokenBalance(Utils.wethAddress(), address(this));
            if (remainingAmount > 0) {
              IWETH(Utils.wethAddress()).withdraw(remainingAmount);
            }
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
        revert("METHOD NOT SUPPORTED");
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("0xV4", "1.0.0"));
    }

    function _swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes memory payload) private {

        ZeroxData memory data = abi.decode(payload, (ZeroxData));

        address _fromToken = address(fromToken);
        address _toToken = address(toToken);

        if (address(fromToken) == Utils.ethAddress()) {
            _fromToken = Utils.wethAddress();
        }
        else if (address(toToken) == Utils.ethAddress()) {
            _toToken = Utils.wethAddress();
        }

        require(address(data.order.takerToken) == address(_fromToken), "Invalid from token!!");
        require(address(data.order.makerToken) == address(_toToken), "Invalid to token!!");

        Utils.approve(exchange, address(_fromToken), fromAmount);

        IZeroxV4(exchange).fillRfqOrder(
            data.order,
            data.signature,
            uint128(fromAmount)
        );

        if (address(toToken) == Utils.ethAddress()) {
            uint256 receivedAmount = Utils.tokenBalance(Utils.wethAddress(), address(this));
            IWETH(Utils.wethAddress()).withdraw(receivedAmount);
        }
    }
}
