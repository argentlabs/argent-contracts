pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../../IWETH.sol";
import "./IZeroxV2.sol";
import "./LibOrderV2.sol";
import "../Utils.sol";
import "../IExchange.sol";

import "../libraries/LibBytes.sol";
import "../../AdapterStorage.sol";


contract ZeroxV2 is IExchange, AdapterStorage {
    using LibBytes for bytes;

    struct ZeroxData {
        LibOrderV2.Order[] orders;
        bytes[] signatures;
    }

    struct LocalData {
      address erc20Proxy;
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
        address exchange,
        bytes calldata payload
    )
        external
        payable
        override

    {
        address _fromToken = address(fromToken);

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

        address _fromToken = address(fromToken);

        if (address(fromToken) == Utils.ethAddress()) {
            IWETH(Utils.wethAddress()).deposit{value: fromAmount}();
            _fromToken = Utils.wethAddress();
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
            uint256 remainingAmount = Utils.tokenBalance(address(_fromToken), address(this));
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
        return keccak256(abi.encodePacked("0XV2", "1.0.0"));
    }

    function _swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes memory payload
    )
        private
    {

        address _fromToken = address(fromToken);
        address _toToken = address(toToken);

        if (_fromToken == Utils.ethAddress()) {
            _fromToken = Utils.wethAddress();
        }

        else if (_toToken == Utils.ethAddress()) {
            _toToken = Utils.wethAddress();
        }

        ZeroxData memory data = abi.decode(payload, (ZeroxData));

        bytes32 key = getKey();
        bytes memory localData = adapterVsData[key];
        LocalData memory lData = abi.decode(localData, (LocalData));

        for (uint256 i = 0; i < data.orders.length; i++) {
            address srcToken = data.orders[i].takerAssetData.readAddress(16);
            require(srcToken == address(_fromToken), "Invalid from token!!");

            address destToken = data.orders[i].makerAssetData.readAddress(16);
            require(destToken == address(_toToken), "Invalid to token!!");
        }

        Utils.approve(lData.erc20Proxy, address(_fromToken), fromAmount);

        IZeroxV2(exchange).marketSellOrdersNoThrow(
            data.orders,
            fromAmount,
            data.signatures
        );

        if (address(toToken) == Utils.ethAddress()) {
            uint256 receivedAmount = Utils.tokenBalance(Utils.wethAddress(), address(this));
            IWETH(Utils.wethAddress()).withdraw(receivedAmount);
        }
    }
}
