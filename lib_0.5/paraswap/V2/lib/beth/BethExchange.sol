pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./IBETH.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract BethExchange is IExchange, TokenFetcher {
    using Address for address;

    address public constant BETH = address(0xc0829421C1d260BD3cB3E0F06cfE2D52db2cE315);

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
        bytes memory payload
    )
        private
        returns (uint256)
    {

        Utils.approve(address(BETH), address(fromToken));

        if (address(fromToken) == BETH){
            require(address(toToken) == Utils.ethAddress(), "Destination token should be ETH");
            IBETH(BETH).withdraw(fromAmount);
        }
        else if (address(fromToken) == Utils.ethAddress()) {
            require(address(toToken) == BETH, "Destination token should be BETH");
            IBETH(BETH).deposit.value(fromAmount)();
        }
        else {
            revert("Invalid fromToken");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}
