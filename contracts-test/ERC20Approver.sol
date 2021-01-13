pragma solidity ^0.7.6;
import "../contracts/wallet/base/BaseModule.sol";
import "../lib/other/ERC20.sol";

// SPDX-License-Identifier: GPL-3.0-or-later
contract ERC20Approver is BaseModule {

    // used by NftTransfer's Tests
    function approveERC20(address _erc20Contract, address _spender, uint256 _amount)
    external
    onlyWalletOwner()
    {
        ERC20(_erc20Contract).approve(_spender, _amount);
    }

    // function getRequiredSignatures(address, bytes calldata) external view override returns (uint256, OwnerSignature) {
    //     return (1, OwnerSignature.Required);
    // }
}