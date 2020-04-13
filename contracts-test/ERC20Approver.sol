pragma solidity ^0.5.4;
import "../contracts/wallet/BaseWallet.sol";
import "../contracts/modules/common/BaseModule.sol";
import "../contracts/modules/common/OnlyOwnerModule.sol";

contract ERC20Approver is BaseModule, OnlyOwnerModule {

    bytes32 constant NAME = "ERC20Approver";

    constructor(ModuleRegistry _registry) BaseModule(_registry, GuardianStorage(0), NAME) public {}

    // used by NftTransfer's Tests
    function approveERC20(BaseWallet _wallet, address _erc20Contract, address _spender, uint256 _amount)
        external
        onlyWalletOwner(_wallet)
    {
        invokeWallet(address(_wallet), _erc20Contract, 0, abi.encodeWithSignature("approve(address,uint256)", _spender, _amount));
    }

}