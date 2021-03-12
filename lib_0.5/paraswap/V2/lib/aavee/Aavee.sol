pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "./IAavee.sol";
import "../Utils.sol";
import "../IExchange.sol";
import "../TokenFetcher.sol";


contract Aavee is IExchange, TokenFetcher {
    using Address for address;

    struct AaveeData {
        address aToken;
    }

    uint16 public refCode;

    address public spender;

    event RefCodeChanged(uint16 refCode);

    constructor(uint16 _refCode, address _spender) public {
        refCode = _refCode;
        spender = _spender;
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

    function setRefCode(uint16 _refCode) external onlyOwner {
        refCode = _refCode;
        emit RefCodeChanged(_refCode);
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
        AaveeData memory data = abi.decode(payload, (AaveeData));

        Utils.approve(spender, address(fromToken));

        if (address(fromToken) == address(data.aToken)) {
            require(
                IAaveToken(data.aToken).underlyingAssetAddress() == address(toToken),
                "Invalid to token"
            );

            IAaveToken(data.aToken).redeem(fromAmount);
        }
        else if(address(toToken) == address(data.aToken)) {
            require(
                IAaveToken(data.aToken).underlyingAssetAddress() == address(fromToken),
                "Invalid to token"
            );
            if (address(fromToken) == Utils.ethAddress()) {
                IAaveLendingPool(exchange).deposit.value(fromAmount)(fromToken, fromAmount, refCode);
            }
            else {
                IAaveLendingPool(exchange).deposit(fromToken, fromAmount, refCode);
            }
        }
        else {
            revert("Invalid aToken");
        }

        uint256 receivedAmount = Utils.tokenBalance(address(toToken), address(this));

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

}
