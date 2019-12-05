pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";

contract WalletOwnershipManager is BaseModule, RelayerModule, OnlyOwnerModule {
  bytes32 constant NAME = "WalletOwnershipManager";

  constructor(
    ModuleRegistry _registry
  )
    BaseModule(_registry, NAME)
    public
  {
  }

  function setOwner(
    BaseWallet _wallet,
    address _newOwner
  )
    external
    onlyWalletOwner(_wallet)
  {
    _wallet.setOwner(_newOwner);
  }
}
