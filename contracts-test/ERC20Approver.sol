pragma solidity ^0.6.8;
import "../contracts/wallet/BaseWallet.sol";
import "../contracts/modules/common/BaseModule.sol";
import "../contracts/modules/common/OnlyOwnerModule.sol";

// SPDX-License-Identifier: GPL-3.0-only
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