pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./IChai.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract ChaiExchange is IExchange, TokenFetcher {

    address public constant CHAI = address(0x06AF07097C9Eeb7fD685c692751D5C66dB49c215);
    address public constant DAI = address(0x6B175474E89094C44Da98b954EedeAC495271d0F);

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

        return _swap(
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
        returns (uint256)
    {

        return _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            exchange,
            payload
        );
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
        returns (uint256)
    {

        Utils.approve(address(CHAI), address(fromToken));

        if (address(fromToken) == CHAI){
            require(address(toToken) == DAI, "Destination token should be DAI");
            IChai(CHAI).exit(address(this), fromAmount);
        }
        else if (address(fromToken) == DAI) {
            require(address(toToken) == CHAI, "Destination token should be CHAI");
            IChai(CHAI).join(address(this), fromAmount);
        }
        else {
            revert("Invalid fromToken");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}
