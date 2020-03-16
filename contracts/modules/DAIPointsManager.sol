pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";

contract DAIPointsManager is BaseModule, RelayerModule, OnlyOwnerModule {
  bytes32 constant NAME = "DAIPointsManager";
  address public dai;
  address public daiPoints;

  constructor(
    ModuleRegistry _registry,
    address _dai,
    address _daiPoints
  )
    BaseModule(_registry, NAME)
    public
  {
    require(_dai != address(0), "DAI address must not be null");
    require(_daiPoints != address(0), "DAIPoints address must not be null");
    dai = _dai;
    daiPoints = _daiPoints;
  }

  function getDAIPoints(
    BaseWallet _wallet,
    uint256 _amount
  )
    external
    onlyWalletOwner(_wallet)
  {
    _wallet.invoke(dai, 0, abi.encodeWithSignature("approve(address,uint256)", daiPoints, _amount));
    _wallet.invoke(daiPoints, 0, abi.encodeWithSignature("getDAIPoints(uint256)", _amount));
  }

  function getDAIPointsToAddress(
    BaseWallet _wallet,
    uint256 _amount,
    address _recipient
  )
    external
    onlyWalletOwner(_wallet)
  {
    _wallet.invoke(dai, 0, abi.encodeWithSignature("approve(address,uint256)", daiPoints, _amount));
    _wallet.invoke(daiPoints, 0, abi.encodeWithSignature("getDAIPointsToAddress(uint256,address)", _amount, _recipient));
  }
}
