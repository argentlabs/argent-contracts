pragma solidity =0.7.5;

import '@uniswap/lib/contracts/libraries/TransferHelper.sol';

import "./ITokenTransferProxy.sol";
import './lib/UniswapV3Lib.sol';
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import './IWETH.sol';
import "./AdapterStorage.sol";

contract UniswapProxyTest is AdapterStorage {
    using SafeMath for uint;

    address public constant ETH_IDENTIFIER = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable UNISWAP_FACTORY;
    address public immutable WETH;
    bytes32 public immutable UNISWAP_INIT_CODE;

    constructor(address _weth, address _factory, bytes32 _initCode) public {
        WETH = _weth;
        UNISWAP_FACTORY = _factory;
        UNISWAP_INIT_CODE = _initCode;
    }

    function swapOnUniswap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path
    )
        external
        payable
        returns (uint256 tokensBought)
    {
        tokensBought = _swap(
            UNISWAP_FACTORY,
            UNISWAP_INIT_CODE,
            amountIn,
            path
        );

        require(tokensBought >= amountOutMin, "UniswapProxy: INSUFFICIENT_OUTPUT_AMOUNT");
    }

    function swapOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path
    )
        external
        payable
        returns (uint256 tokensBought)
    {
        tokensBought = _swap(
            factory,
            initCode,
            amountIn,
            path
        );
        require(tokensBought >= amountOutMin, "UniswapProxy: INSUFFICIENT_OUTPUT_AMOUNT");
    }

    function buyOnUniswap(
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path
    )
        external
        payable
        returns (uint256 tokensSold)
    {
        tokensSold = _buy(
            UNISWAP_FACTORY,
            UNISWAP_INIT_CODE,
            amountOut,
            path
        );

        require(tokensSold <= amountInMax, "UniswapProxy: INSUFFICIENT_INPUT_AMOUNT");
    }

    function buyOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path
    )
        external
        payable
        returns (uint256 tokensSold)
    {
        tokensSold = _buy(
            factory,
            initCode,
            amountOut,
            path
        );

        require(tokensSold <= amountInMax, "UniswapProxy: INSUFFICIENT_INPUT_AMOUNT");
    }

    function transferTokens(
        address token,
        address from,
        address to,
        uint256 amount
    )
        private
    {
        ITokenTransferProxy(getTokenTransferProxy()).transferFrom(
            token, from, to, amount
        );
    }

    function _swap(
        address factory,
        bytes32 initCode,
        uint256 amountIn,
        address[] calldata path
    )
        private
        returns (uint256 tokensBought)
    {
        require(path.length > 1, "More than 1 token required");
        uint8 pairs = uint8(path.length - 1);
        bool tokensBoughtEth;
        tokensBought = amountIn;
        address receiver;

        for(uint8 i = 0; i < pairs; i++) {
            address tokenSold = path[i];
            address tokenBought = path[i+1];

            address currentPair = receiver;

            if (i == pairs - 1) {
                if (tokenBought == ETH_IDENTIFIER) {
                    tokenBought = WETH;
                    tokensBoughtEth = true;
                }
            }
            if (i == 0) {
                if (tokenSold == ETH_IDENTIFIER) {
                    tokenSold = WETH;
                    currentPair = UniswapV3Lib.pairFor(factory, tokenSold, tokenBought, initCode);
                    uint256 amount = msg.value;
                    IWETH(WETH).deposit{value: amount}();
                    assert(IWETH(WETH).transfer(currentPair, amount));
                }
                else {
                    currentPair = UniswapV3Lib.pairFor(factory, tokenSold, tokenBought, initCode);
                    transferTokens(
                        tokenSold, msg.sender, currentPair, amountIn
                    );
                }
            }

            //AmountIn for this hop is amountOut of previous hop
            tokensBought = UniswapV3Lib.getAmountOutByPair(tokensBought, currentPair, tokenSold, tokenBought);

            if ((i + 1) == pairs) {
                if ( tokensBoughtEth ) {
                    receiver = address(this);
                }
                else {
                    receiver = msg.sender;
                }
            }
            else {
                receiver = UniswapV3Lib.pairFor(factory, tokenBought, path[i+2] == ETH_IDENTIFIER ? WETH : path[i+2], initCode);
            }

            (address token0,) = UniswapV3Lib.sortTokens(tokenSold, tokenBought);
            (uint256 amount0Out, uint256 amount1Out) = tokenSold == token0 ? (uint256(0), tokensBought) : (tokensBought, uint256(0));
            IUniswapV2Pair(currentPair).swap(
                amount0Out, amount1Out, receiver, new bytes(0)
            );
        }
        if (tokensBoughtEth) {
            IWETH(WETH).withdraw(tokensBought);
            TransferHelper.safeTransferETH(msg.sender, tokensBought);
        }
    }

    function _buy(
        address factory,
        bytes32 initCode,
        uint256 amountOut,
        address[] calldata path
    )
        private
        returns (uint256 tokensSold)
    {
        require(path.length > 1, "More than 1 token required");
        bool tokensBoughtEth;
        uint8 length = uint8(path.length);

        uint256[] memory amounts = new uint256[](length);
        address[] memory pairs = new address[](length - 1);

        amounts[length - 1] = amountOut;

        for (uint8 i = length - 1; i > 0; i--) {
            (amounts[i - 1], pairs[i - 1]) = UniswapV3Lib.getAmountInAndPair(
                factory,
                amounts[i],
                path[i-1],
                path[i],
                initCode
            );
        }

        tokensSold = amounts[0];

        for(uint8 i = 0; i < length - 1; i++) {
            address tokenSold = path[i];
            address tokenBought = path[i+1];

            if (i == length - 2) {
                if (tokenBought == ETH_IDENTIFIER) {
                    tokenBought = WETH;
                    tokensBoughtEth = true;
                }
            }
            if (i == 0) {
                if (tokenSold == ETH_IDENTIFIER) {
                    tokenSold = WETH;
                    TransferHelper.safeTransferETH(msg.sender, msg.value.sub(tokensSold));
                    IWETH(WETH).deposit{value: tokensSold}();
                    assert(IWETH(WETH).transfer(pairs[i], tokensSold));
                }
                else {
                    transferTokens(
                        tokenSold, msg.sender, pairs[i], tokensSold
                    );
                }
            }

            address receiver;

            if (i == length - 2) {
                if (tokensBoughtEth) {
                    receiver = address(this);
                }
                else {
                    receiver = msg.sender;
                }
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
            IWETH(WETH).withdraw(amountOut);
            TransferHelper.safeTransferETH(msg.sender, amountOut);
        }
    }
}
