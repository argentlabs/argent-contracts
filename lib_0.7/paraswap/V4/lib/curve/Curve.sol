pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "./ICurve.sol";
import "../Utils.sol";
import "../IExchange.sol";

import "../../AdapterStorage.sol";


contract Curve is IExchange, AdapterStorage {

  struct CurveData {
    int128 i;
    int128 j;
    uint256 deadline;
    bool underlyingSwap;
    bool v3;
  }

  struct LocalData {
      address dai;
      address usdc;
      address cDAI;
      address cUSDC;
      address curveCompoundExchange;
  }

  function initialize(bytes calldata data) external override {
     bytes32 key = getKey();
     require(!adapterInitialized[key], "Adapter already initialized");
     abi.decode(data, (LocalData));
     adapterInitialized[key] = true;
     adapterVsData[key] = data;
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
    override

  {

    CurveData memory curveData = abi.decode(payload, (CurveData));

    Utils.approve(address(exchange), address(fromToken), fromAmount);

    if (curveData.underlyingSwap) {
      if (curveData.v3){
        require(
          IPoolV3(exchange).underlying_coins(uint256(curveData.i)) == address(fromToken),
          "Invalid from token"
        );
        require(
          IPoolV3(exchange).underlying_coins(uint256(curveData.j)) == address(toToken),
          "Invalid to token"
        );
      }
      else {
        require(
          IPool(exchange).underlying_coins(curveData.i) == address(fromToken),
          "Invalid from token"
        );
        require(
          IPool(exchange).underlying_coins(curveData.j) == address(toToken),
          "Invalid to token"
        );
      }
      ICurvePool(exchange).exchange_underlying(curveData.i, curveData.j, fromAmount, toAmount);

    }
    else {
      if (curveData.v3) {
        require(
          IPoolV3(exchange).coins(uint256(curveData.i)) == address(fromToken),
          "Invalid from token"
        );
        require(
          IPoolV3(exchange).coins(uint256(curveData.j)) == address(toToken),
          "Invalid to token"
        );
      }
      else {
        require(
          IPool(exchange).coins(curveData.i) == address(fromToken),
          "Invalid from token"
        );
        require(
          IPool(exchange).coins(curveData.j) == address(toToken),
          "Invalid to token"
        );
      }
      if (address(fromToken) == Utils.ethAddress()) {
        ICurveEthPool(exchange).exchange{value: fromAmount}(curveData.i, curveData.j, fromAmount, toAmount);
      }
      else {
        ICurvePool(exchange).exchange(curveData.i, curveData.j, fromAmount, toAmount);
      }

    }
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
    override

  {
    revert("METHOD NOT SUPPORTED");

  }

  //Swap on Curve Compound
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
    bytes32 key = getKey();
    bytes memory localData = adapterVsData[key];
    LocalData memory lData = abi.decode(localData, (LocalData));

    Utils.approve(
      address(lData.curveCompoundExchange),
      address(fromToken), fromAmount
    );
    if (
      (address(fromToken) == lData.cDAI && address(toToken) == lData.cUSDC) || (address(fromToken) == lData.cUSDC && address(toToken) == lData.cDAI)
    )
    {
      int128 i = address(fromToken) == lData.cDAI ? 0 : 1;
      int128 j = address(toToken) == lData.cDAI ? 0 : 1;

      ICurvePool(lData.curveCompoundExchange).exchange(
        i,
        j,
        fromAmount,
        1
      );
    }
    else if (
      (address(fromToken) == lData.dai && address(toToken) == lData.usdc) || (address(fromToken) == lData.usdc && address(toToken) == lData.dai)
    )
    {
      int128 i = address(fromToken) == lData.dai ? 0 : 1;
      int128 j = address(toToken) == lData.dai ? 0 : 1;

      ICurvePool(lData.curveCompoundExchange).exchange_underlying(
        i,
        j,
        fromAmount,
        1
      );
    }
    else {
      revert("TOKEN NOT SUPPORTED");
    }

    uint256 receivedAmount = Utils.tokenBalance(
      address(toToken),
      address(this)
    );

    Utils.transferTokens(address(toToken), msg.sender, receivedAmount);

    return receivedAmount;

  }

  function getKey() public override pure returns(bytes32) {
      return keccak256(abi.encodePacked("CURVE", "1.0.0"));
  }

}

