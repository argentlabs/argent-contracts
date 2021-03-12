pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./IIdle.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract Idle is IExchange, TokenFetcher {
    using Address for address;

    struct IdleData {
        address idleToken;
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
        bytes memory payload) private returns (uint256) {

        IdleData memory data = abi.decode(payload, (IdleData));

        Utils.approve(address(data.idleToken), address(fromToken));

        if (address(fromToken) == address(data.idleToken)) {
            require(
                IIdle(data.idleToken).token() == address(toToken),
                "Invalid to token"
            );

            IIdle(data.idleToken).redeemIdleToken(
                fromAmount,
                false,
                new uint256[](0)
            );
        }
        else if (address(toToken) == address(data.idleToken)) {
            require(
                IIdle(data.idleToken).token() == address(fromToken),
                "Invalid to token"
            );
            IIdle(data.idleToken).mintIdleToken(
                fromAmount,
                new uint256[](0)
            );
        }
        else {
            revert("Invalid token pair!!");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}
