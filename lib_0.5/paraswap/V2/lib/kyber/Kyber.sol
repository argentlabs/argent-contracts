pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./IKyberNetwork.sol";
import "../IExchange.sol";
import "../Utils.sol";
import "../TokenFetcher.sol";


contract Kyber is IExchange, TokenFetcher {
    using Address for address;

    struct KyberData {
        uint256 minConversionRateForBuy;
    }

    address public feeWallet;

    constructor(address _feeWallet) public {
        feeWallet = _feeWallet;
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

    function setFeeWallet(address _feeWallet) external onlyOwner {
        feeWallet = _feeWallet;
    }

    function maxGasPrice(address kyberAddress) external view returns (uint) {
        return IKyberNetwork(kyberAddress).maxGasPrice();
    }

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address kyberAddress,
        bytes calldata payload) external payable returns (uint256) {

        Utils.approve(address(kyberAddress), address(fromToken));

        uint256 receivedAmount = 0;

        if (address(fromToken) == Utils.ethAddress()) {
            receivedAmount = IKyberNetwork(kyberAddress).trade.value(fromAmount)(
                address(fromToken),
                fromAmount,
                address(toToken),
                address(this),
                Utils.maxUint(),
                toAmount,
                feeWallet
            );
        }
        else {
            receivedAmount = IKyberNetwork(kyberAddress).trade(
                address(fromToken),
                fromAmount,
                address(toToken),
                address(this),
                Utils.maxUint(),
                toAmount,
                feeWallet
            );
        }

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address kyberAddress,
        bytes calldata payload
    )
        external
        payable
        returns (uint256)
    {
        KyberData memory data = abi.decode(payload, (KyberData));

        Utils.approve(address(kyberAddress), address(fromToken));

        if (address(fromToken) == Utils.ethAddress()) {
            IKyberNetwork(kyberAddress).trade.value(fromAmount)(
                address(fromToken),
                fromAmount,
                address(toToken),
                address(this),
                toAmount,
                data.minConversionRateForBuy,
                feeWallet
            );
        }
        else {
            IKyberNetwork(kyberAddress).trade(
                address(fromToken),
                fromAmount,
                address(toToken),
                address(this),
                toAmount,
                data.minConversionRateForBuy,
                feeWallet
            );
        }

        uint256 remainingAmount = Utils.tokenBalance(
          address(fromToken),
          address(this)
        );
        uint256 receivedAmount = Utils.tokenBalance(
          address(toToken),
          address(this)
        );
        Utils.transferTokens(address(fromToken), msg.sender, remainingAmount);
        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;

    }
}
