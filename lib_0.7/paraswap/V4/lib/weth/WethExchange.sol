pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../../IWETH.sol";
import "../Utils.sol";
import "../IExchange.sol";



contract WethExchange is IExchange {

    function initialize(bytes calldata data) external override {
        revert("METHOD NOT IMPLEMENTED");
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

        _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            exchange,
            payload
        );
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
        return keccak256(abi.encodePacked("WETH", "1.0.0"));
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
        address weth = Utils.wethAddress();

        if (address(fromToken) == weth){
            require(address(toToken) == Utils.ethAddress(), "Destination token should be ETH");
            IWETH(weth).withdraw(fromAmount);
        }
        else if (address(fromToken) == Utils.ethAddress()) {
            require(address(toToken) == weth, "Destination token should be weth");
            IWETH(weth).deposit{value: fromAmount}();
        }
        else {
            revert("Invalid fromToken");
        }

    }

}
