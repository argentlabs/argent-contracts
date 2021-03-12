pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/utils/Address.sol";
import "./IBZX.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract BZX is IExchange, TokenFetcher {
    using Address for address;

    struct BZXData {
        address iToken;
    }

    address public weth;

    constructor(address wethAddress) public {
        weth = wethAddress;
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
        bytes memory payload
    )
        private
        returns (uint256) {

        BZXData memory data = abi.decode(payload, (BZXData));

        Utils.approve(address(data.iToken), address(fromToken));

        if (address(fromToken) == address(data.iToken)) {
            if (address(toToken) == Utils.ethAddress()) {
                require(
                    IBZX(data.iToken).loanTokenAddress() == weth,
                    "Invalid to token"
                );
                IBZX(data.iToken).burnToEther(address(this), fromAmount);
            }
            else {
                require(
                    IBZX(data.iToken).loanTokenAddress() == address(toToken),
                    "Invalid to token"
                );
                IBZX(data.iToken).burn(address(this), fromAmount);
            }
        }
        else if (address(toToken) == address(data.iToken)){
            if (address(fromToken) == Utils.ethAddress()) {
                require(
                    IBZX(data.iToken).loanTokenAddress() == weth,
                    "Invalid from token"
                );

                IBZX(data.iToken).mintWithEther.value(fromAmount)(address(this));
            }
            else {
                require(
                    IBZX(data.iToken).loanTokenAddress() == address(fromToken),
                    "Invalid from token"
                );
                IBZX(data.iToken).mint(address(this), fromAmount);
            }
        }
        else {
            revert("Invalid token pair!!");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}
