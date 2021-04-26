pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "../UniswapV3Lib.sol";

import "../IExchange.sol";
import "../Utils.sol";

import "../../AdapterStorage.sol";
import "../../IWETH.sol";


contract UniswapV2Mock is IExchange, AdapterStorage {
    using SafeMath for uint256;

    struct UniswapV2Data {
        address[] path;
    }

    struct LocalData {
        address uinswapV2Router;
        address factory;
        bytes32 initCode;
    }

    ////// Argent addition /////////////////
    address public immutable weth;
    bytes32 public immutable exchangeName;
    function wethAddress() internal view returns (address) { return weth; }
    constructor(address _weth, bytes32 _exchangeName) {
        weth = _weth;
        exchangeName = _exchangeName;
    }
    ////////////////////////////////////////

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

        UniswapV2Data memory data = abi.decode(payload, (UniswapV2Data));
        _swap(
            fromAmount,
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
        payable
        override
    {

        UniswapV2Data memory data = abi.decode(payload, (UniswapV2Data));

        _buy(
            fromAmount,
            toAmount,
            data.path
        );
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
        returns (uint256 receivedAmount)
    {

        address[] memory path = new address[](2);

        path[0] = address(fromToken) == Utils.ethAddress() ? wethAddress() : address(fromToken);
        path[1] = address(toToken) == Utils.ethAddress() ? wethAddress() : address(toToken);
        bytes32 key = getKey();
        bytes memory localData = adapterVsData[key];
        LocalData memory data = abi.decode(localData, (LocalData));

        //TODO removed token transfer to msg.sender for delegatecall. Fix this onchain swap
        /**return _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            data.uinswapV2Router,
            path
        );*/
    }

    function getKey() public override view returns(bytes32) {
      return keccak256(abi.encodePacked(exchangeName, "1.0.0"));
    }

    function _buy(
        uint256 amountInMax,
        uint256 amountOut,
        address[] memory path
    )
        private
        returns (uint256 tokensSold)
    {
        bytes32 key = getKey();
        bytes memory localData = adapterVsData[key];
        LocalData memory data = abi.decode(localData, (LocalData));

        require(path.length > 1, "More than 1 token required");
        bool tokensBoughtEth;
        uint8 length = uint8(path.length);

        uint256[] memory amounts = new uint256[](length);
        address[] memory pairs = new address[](length - 1);

        amounts[length - 1] = amountOut;

        for (uint8 i = length - 1; i > 0; i--) {
            (amounts[i - 1], pairs[i - 1]) = UniswapV3Lib.getAmountInAndPair(
                data.factory,
                amounts[i],
                path[i-1],
                path[i],
                data.initCode
            );
        }

        tokensSold = amounts[0];
        require(tokensSold <= amountInMax, "UniswapV3Router: INSUFFICIENT_INPUT_AMOUNT");

        for(uint8 i = 0; i < length - 1; i++) {
            address tokenSold = path[i];
            address tokenBought = path[i+1];

            if (i == length - 2) {
                if (tokenBought == Utils.ethAddress()) {
                    tokenBought = wethAddress();
                    tokensBoughtEth = true;
                }
            }
            if (i == 0) {
                if (tokenSold == Utils.ethAddress()) {
                    tokenSold = wethAddress();
                    IWETH(wethAddress()).deposit{value: tokensSold}();
                    assert(IWETH(wethAddress()).transfer(pairs[i], tokensSold));
                }
                else {
                    TransferHelper.safeTransferFrom(
                        tokenSold, msg.sender, pairs[i], tokensSold
                    );
                }
            }

            address receiver;

            if (i == length - 2) {

                receiver = address(this);

            }
            else {
                receiver = pairs[i+1];
            }

            (address token0,) = UniswapV3Lib.sortTokens(tokenSold, tokenBought);
            (uint256 amount0Out, uint256 amount1Out) = tokenSold == token0 ? (uint256(0), amounts[i+1]) : (amounts[i+1], uint256(0));
            IUniswapV2Pair(pairs[i]).swap(
                amount0Out, amount1Out, receiver, new bytes(0)
            );

        }
        if (tokensBoughtEth) {
            IWETH(wethAddress()).withdraw(amountOut);
        }
    }

    function _swap(
        uint256 fromAmount,
        address[] memory path
    )
        private
        returns(uint256 tokensBought)
    {
        require(path.length > 1, "More than 1 token required");
        uint8 pairs = uint8(path.length - 1);
        bool tokensBoughtEth;
        tokensBought = fromAmount;
        address receiver;
        bytes32 key = getKey();
        bytes memory localData = adapterVsData[key];
        LocalData memory data = abi.decode(localData, (LocalData));
        //
        for(uint8 i = 0; i < pairs; i++) {
            address tokenSold = path[i];
            address tokenBought = path[i+1];

            address currentPair = receiver;
            if (i == pairs - 1) {
                if (tokenBought == Utils.ethAddress()) {
                    tokenBought = wethAddress();
                    tokensBoughtEth = true;
                }
            }
            if (i == 0) {
                if (tokenSold == Utils.ethAddress()) {
                    tokenSold = wethAddress();
                    currentPair = UniswapV3Lib.pairFor(data.factory, tokenSold, tokenBought, data.initCode);
                    IWETH(wethAddress()).deposit{value: fromAmount}();
                    assert(IWETH(wethAddress()).transfer(currentPair, fromAmount));
                }
                else {
                    currentPair = UniswapV3Lib.pairFor(data.factory, tokenSold, tokenBought, data.initCode);
                    TransferHelper.safeTransfer(
                        tokenSold, currentPair, fromAmount
                    );
                }
            }

            tokensBought = UniswapV3Lib.getAmountOutByPair(tokensBought, currentPair, tokenSold, tokenBought);

            if ((i + 1) == pairs) {
                receiver = address(this);
            }
            else {
                receiver = UniswapV3Lib.pairFor(data.factory, tokenBought, path[i+2] == Utils.ethAddress() ? wethAddress() : path[i+2], data.initCode);
            }

            (address token0,) = UniswapV3Lib.sortTokens(tokenSold, tokenBought);
            (uint256 amount0Out, uint256 amount1Out) = tokenSold == token0 ? (uint256(0), tokensBought) : (tokensBought, uint256(0));
            IUniswapV2Pair(currentPair).swap(
                amount0Out, amount1Out, receiver, new bytes(0)
            );

        }

        if (tokensBoughtEth) {
            IWETH(wethAddress()).withdraw(tokensBought);
        }
    }
}
