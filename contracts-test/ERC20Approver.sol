pragma solidity ^0.6.9;
import "../contracts/wallet/BaseWallet.sol";
import "../contracts/modules/common/OnlyOwnerModule.sol";

// SPDX-License-Identifier: GPL-3.0-only
contract ERC20Approver is OnlyOwnerModule {

    bytes32 constant NAME = "ERC20Approver";

    constructor(IModuleRegistry _registry) BaseModule(_registry, IGuardianStorage(0), NAME) public {}

    // used by NftTransfer's Tests
    function approveERC20(address _wallet, address _erc20Contract, address _spender, uint256 _amount)
        external
        onlyWalletOwner(_wallet)
    {
        invokeWallet(_wallet, _erc20Contract, 0, abi.encodeWithSignature("approve(address,uint256)", _spender, _amount));
    }

}