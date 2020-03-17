pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../base/Managed.sol";

contract DAIPointsManager is BaseModule, RelayerModule, OnlyOwnerModule, Managed {
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

  function setDaiAddress(address _dai) public onlyManager {
    dai = _dai;
  }

  function setDaiPointsAddress(address _daiPoints) public onlyManager {
    daiPoints = _daiPoints;
  }
}
