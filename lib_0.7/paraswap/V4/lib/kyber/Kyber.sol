pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./IKyberNetwork.sol";
import "../IExchange.sol";
import "../Utils.sol";

import "./IKyberHint.sol";
import "../../AdapterStorage.sol";


contract Kyber is IExchange, AdapterStorage {

    struct KyberData {
        uint256 minConversionRateForBuy;
        bytes hint;
    }

    struct LocalData {
      address payable feeWallet;
      uint256 platformFeeBps;
      address kyberProxy;
      address kyberHint;
      bytes32[] brigedReserves;
    }

  function initialize(bytes calldata data) external override {
     bytes32 key = getKey();
     require(!adapterInitialized[key], "Adapter already initialized");
     abi.decode(data, (LocalData));
     adapterInitialized[key] = true;
     adapterVsData[key] = data;
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
        KyberData memory data = abi.decode(payload, (KyberData));
        LocalData memory lData = abi.decode(adapterVsData[getKey()], (LocalData));

        _swap(
            address(fromToken),
            address(toToken),
            fromAmount,
            toAmount,
            kyberAddress,
            data.hint,
            lData.feeWallet,
            lData.platformFeeBps
        );
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
        KyberData memory data = abi.decode(payload, (KyberData));

        bytes32 key = getKey();
        bytes memory localData = adapterVsData[key];
        LocalData memory lData = abi.decode(localData, (LocalData));

        Utils.approve(address(kyberAddress), address(fromToken), fromAmount);

        if (address(fromToken) == Utils.ethAddress()) {
            IKyberNetwork(kyberAddress).tradeWithHintAndFee{value: fromAmount}(
                address(fromToken),
                fromAmount,
                address(toToken),
                payable(address(this)),
                toAmount,
                data.minConversionRateForBuy,
                lData.feeWallet,
                lData.platformFeeBps,
                data.hint
            );
        }
        else {
            IKyberNetwork(kyberAddress).tradeWithHintAndFee(
                address(fromToken),
                fromAmount,
                address(toToken),
                payable(address(this)),
                toAmount,
                data.minConversionRateForBuy,
                lData.feeWallet,
                lData.platformFeeBps,
                data.hint
            );
        }
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

        LocalData memory lData = abi.decode(adapterVsData[getKey()], (LocalData));


        if (address(fromToken) == Utils.ethAddress()) {
            hint = IKyberHint(lData.kyberHint).buildEthToTokenHint(toToken, IKyberHint.TradeType.MaskOut, lData.brigedReserves, emptyArray);
        }
        else if (address(toToken) == Utils.ethAddress()) {
            hint = IKyberHint(lData.kyberHint).buildTokenToEthHint(fromToken, IKyberHint.TradeType.MaskOut, lData.brigedReserves, emptyArray);
        }
        else {
            hint = IKyberHint(lData.kyberHint).buildTokenToTokenHint(
                fromToken,
                IKyberHint.TradeType.MaskOut,
                lData.brigedReserves,
                emptyArray,
                toToken,
                IKyberHint.TradeType.MaskOut,
                lData.brigedReserves,
                emptyArray
            );
        }

        return _swap(
            address(fromToken),
            address(toToken),
            fromAmount,
            toAmount,
            lData.kyberProxy,
            hint,
            lData.feeWallet,
            lData.platformFeeBps
        );
    }

    function getKey() public override pure returns(bytes32) {
        return keccak256(abi.encodePacked("KYBER", "1.0.0"));
    }

    function _swap(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address kyberAddress,
        bytes memory hint,
        address payable feeWallet,
        uint256 platformFeeBps

    )
        private
        returns(uint256)
    {
        Utils.approve(kyberAddress, fromToken, fromAmount);

        uint256 receivedAmount = 0;

        if (fromToken == Utils.ethAddress()) {
            receivedAmount = IKyberNetwork(kyberAddress).tradeWithHintAndFee{value: fromAmount}(
                fromToken,
                fromAmount,
                toToken,
                payable(address(this)),
                Utils.maxUint(),
                toAmount,
                feeWallet,
                platformFeeBps,
                hint
            );
        }
        else {
            receivedAmount = IKyberNetwork(kyberAddress).tradeWithHintAndFee(
                fromToken,
                fromAmount,
                toToken,
                payable(address(this)),
                Utils.maxUint(),
                toAmount,
                feeWallet,
                platformFeeBps,
                hint
            );
        }
        return receivedAmount;
    }
}
