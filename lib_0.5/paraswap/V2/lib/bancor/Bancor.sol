pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "../IExchange.sol";
import "../Utils.sol";
import "./IBancor.sol";
import "./IContractRegistry.sol";
import "../TokenFetcher.sol";


contract Bancor is IExchange, TokenFetcher {
    using SafeMath for uint256;
    using Address for address;

    struct BancorData {
        IERC20[] path;
    }

    address public affiliateAccount;
    uint256 public affiliateCode;

    bytes32 public constant BANCOR_NETWORK = 0x42616e636f724e6574776f726b00000000000000000000000000000000000000;

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

    function setAffiliateAccount(address account) external onlyOwner {
        affiliateAccount = account;
    }

    function setAffiliateCode(uint256 code) external onlyOwner {
        affiliateCode = code;
    }

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address registry,
        bytes calldata payload
    )
        external
        payable
        returns (uint256)
    {
        BancorData memory data = abi.decode(payload, (BancorData));

        address bancorNetwork = IContractRegistry(registry).addressOf(BANCOR_NETWORK);

        Utils.approve(bancorNetwork, address(fromToken));

        uint256 receivedAmount = 0;

        if (address(fromToken) == Utils.ethAddress()) {
            receivedAmount = IBancor(bancorNetwork).convert2.value(fromAmount)(
                data.path,
                fromAmount,
                toAmount,
                affiliateAccount,
                affiliateCode
            );
        }
        else {
            receivedAmount = IBancor(bancorNetwork).claimAndConvert2(
                data.path,
                fromAmount,
                toAmount,
                affiliateAccount,
                affiliateCode
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
        address exchange,
        bytes calldata payload
    )
        external
        payable
        returns (uint256)
    {
        revert("METHOD NOT SUPPORTED");

    }

}
