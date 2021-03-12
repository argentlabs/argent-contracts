pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./ICompound.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract Compound is IExchange, TokenFetcher {
    using Address for address;

    struct CompoundData {
        address cToken;
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

        CompoundData memory compoundData = abi.decode(payload, (CompoundData));

        Utils.approve(address(compoundData.cToken), address(fromToken));

        if (address(fromToken) == address(compoundData.cToken)) {
            if (address(toToken) == Utils.ethAddress()) {
                require(
                    address(fromToken) == address(0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5),
                    "Invalid to token"
                );
            }
            else {
                require(
                    ICERC20(compoundData.cToken).underlying() == address(toToken),
                    "Invalid from token"
                );
            }

            ICToken(compoundData.cToken).redeem(fromAmount);
        }
        else if(address(toToken) == address(compoundData.cToken)) {
            if (address(fromToken) == Utils.ethAddress()) {
                require(
                    address(toToken) == address(0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5),
                    "Invalid to token"
                );

                ICEther(compoundData.cToken).mint.value(fromAmount)();
            }
            else {
                require(
                    ICERC20(compoundData.cToken).underlying() == address(fromToken),
                    "Invalid from token"
                );

                ICERC20(compoundData.cToken).mint(fromAmount);
            }
        }
        else {
            revert("Invalid token pair");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }
}
