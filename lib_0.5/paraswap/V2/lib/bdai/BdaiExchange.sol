pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./IBdai.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract BdaiExchange is IExchange, TokenFetcher {

    address public constant BDAI = address(0x6a4FFAafa8DD400676Df8076AD6c724867b0e2e8);
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

        Utils.approve(address(BDAI), address(fromToken));

        if (address(fromToken) == BDAI){
            require(address(toToken) == DAI, "Destination token should be DAI");
            IBdai(BDAI).exit(fromAmount);
        }
        else if (address(fromToken) == DAI) {
            require(address(toToken) == BDAI, "Destination token should be BDAI");
            IBdai(BDAI).join(fromAmount);
        }
        else {
            revert("Invalid fromToken");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

}
