pragma solidity 0.7.5;


import "./UniswapV3Lib.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "../IWETH.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../ITokenTransferProxy.sol";
import '@uniswap/lib/contracts/libraries/TransferHelper.sol';

library UniswapAugustusLib {
    using SafeMath for uint256;

    address constant ETH_ADDRESS = address(
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
    );

    address constant WETH_ADDRESS = address(
        0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    );

    function swap(
        address factory,
        bytes32 initCode,
        uint256 amountIn,
        address[] memory path,
        address tokenTransferProxy
    )
        internal
        returns (uint256 tokensBought)
    {
        uint8 pairs = uint8(path.length - 1);
        require(pairs > 0, "More than 1 token required");
        bool tokensBoughtEth;
        tokensBought = amountIn;
        address receiver;

        for(uint8 i = 0; i < pairs; i++) {
            address tokenSold = path[i];
            address tokenBought = path[i+1];

            address currentPair = receiver;

            if (i == pairs - 1) {
                if (tokenBought == ETH_ADDRESS) {
                    tokenBought = WETH_ADDRESS;
                    tokensBoughtEth = true;
                }
            }
            if (i == 0) {
                if (tokenSold == ETH_ADDRESS) {
                    tokenSold = WETH_ADDRESS;
                    currentPair = UniswapV3Lib.pairFor(factory, tokenSold, tokenBought, initCode);
                    uint256 amount = msg.value;
                    IWETH(WETH_ADDRESS).deposit{value: amount}();
                    assert(IWETH(WETH_ADDRESS).transfer(currentPair, amount));
                }
                else {
                    currentPair = UniswapV3Lib.pairFor(factory, tokenSold, tokenBought, initCode);
                    ITokenTransferProxy(tokenTransferProxy).transferFrom(
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
                receiver = UniswapV3Lib.pairFor(factory, tokenBought, path[i+2] == ETH_ADDRESS ? WETH_ADDRESS : path[i+2], initCode);
            }

            (address token0,) = UniswapV3Lib.sortTokens(tokenSold, tokenBought);
            (uint256 amount0Out, uint256 amount1Out) = tokenSold == token0 ? (uint256(0), tokensBought) : (tokensBought, uint256(0));
            IUniswapV2Pair(currentPair).swap(
                amount0Out, amount1Out, receiver, new bytes(0)
            );

        }

        if (tokensBoughtEth) {
            IWETH(WETH_ADDRESS).withdraw(tokensBought);
            TransferHelper.safeTransferETH(msg.sender, tokensBought);
        }
    }
}
