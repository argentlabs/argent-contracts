pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./IKyberNetwork.sol";
import "../IExchange.sol";
import "../Utils.sol";

import "./IKyberHint.sol";


contract KyberOnchain is IExchange, Ownable {

    struct KyberData {
        uint256 minConversionRateForBuy;
        bytes hint;
    }

    address payable public feeWallet;
    uint256 public platformFeeBps;
    address public kyberProxy;
    address public kyberHint;
    bytes32[] private brigedReserves;

    constructor(
      address payable _feeWallet,
      uint256 _platformFeeBps,
      address _kyberProxy,
      address _kyberHint
    )
        public
    {
        feeWallet = _feeWallet;
        platformFeeBps = _platformFeeBps;
        kyberProxy = _kyberProxy;
        kyberHint = _kyberHint;
        brigedReserves.push(bytes32(0xbb4f617369730000000000000000000000000000000000000000000000000000));//OASIS
        brigedReserves.push(bytes32(0xbb756e6973776170563100000000000000000000000000000000000000000000));//UNISWAP
        brigedReserves.push(bytes32(0xbb756e6973776170563200000000000000000000000000000000000000000000));//UNISWAPV2
        brigedReserves.push(bytes32(0xbb42414e434f5230305632000000000000000000000000000000000000000000));//BANCOR
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    */
    receive() external payable {
    }

    function setFeeWallet(address payable _feeWallet) external onlyOwner {
        feeWallet = _feeWallet;
    }

    function setPlatformFeeBps(uint256 _platformFeeBps) external onlyOwner {
        platformFeeBps = _platformFeeBps;
    }


    function initialize(bytes calldata data) external override {
       revert("METHOD NOT SUPPORTED");
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
        bytes calldata payload
    )
        external
        payable
        override

    {
        revert("METHOD NOT SUPPORTED");
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
        override

    {
        revert("METHOD NOT SUPPORTED");
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
        bytes memory hint;
        uint256[] memory emptyArray = new uint256[](0);


        if (address(fromToken) == Utils.ethAddress()) {
            hint = IKyberHint(kyberHint).buildEthToTokenHint(toToken, IKyberHint.TradeType.MaskOut, brigedReserves, emptyArray);
        }
        else if (address(toToken) == Utils.ethAddress()) {
            hint = IKyberHint(kyberHint).buildTokenToEthHint(fromToken, IKyberHint.TradeType.MaskOut, brigedReserves, emptyArray);
        }
        else {
            hint = IKyberHint(kyberHint).buildTokenToTokenHint(
                fromToken,
                IKyberHint.TradeType.MaskOut,
                brigedReserves,
                emptyArray,
                toToken,
                IKyberHint.TradeType.MaskOut,
                brigedReserves,
                emptyArray
            );
        }

        return _swap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            kyberProxy,
            hint
        );
    }

    function _swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address kyberAddress,
        bytes memory hint

    )
        private
        returns(uint256)
    {
        Utils.approve(address(kyberAddress), address(fromToken), fromAmount);

        uint256 receivedAmount = 0;

        if (address(fromToken) == Utils.ethAddress()) {
            receivedAmount = IKyberNetwork(kyberAddress).tradeWithHintAndFee{value: fromAmount}(
                address(fromToken),
                fromAmount,
                address(toToken),
                address(this),
                Utils.maxUint(),
                toAmount,
                feeWallet,
                platformFeeBps,
                hint
            );
        }
        else {
            receivedAmount = IKyberNetwork(kyberAddress).tradeWithHintAndFee(
                address(fromToken),
                fromAmount,
                address(toToken),
                address(this),
                Utils.maxUint(),
                toAmount,
                feeWallet,
                platformFeeBps,
                hint
            );
        }

        Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

        return receivedAmount;
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("KYBERONCHAIN", "1.0.0"));
    }

}
