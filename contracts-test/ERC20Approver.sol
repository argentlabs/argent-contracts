pragma solidity ^0.6.12;
import "../contracts/wallet/BaseWallet.sol";
import "../contracts/modules/common/OnlyOwnerFeature.sol";

// SPDX-License-Identifier: GPL-3.0-only
contract ERC20Approver is OnlyOwnerFeature {

    bytes32 constant NAME = "ERC20Approver";

    constructor(
        IModuleRegistry _registry, 
        IVersionManager _versionManager
    )
        BaseFeature(_registry, IGuardianStorage(0), _versionManager, NAME)
        public 
    {}

    // used by NftTransfer's Tests
    function approveERC20(address _wallet, address _erc20Contract, address _spender, uint256 _amount)
        external
        onlyWalletOwnerOrFeature(_wallet)
    {
        checkAuthorisedFeatureAndInvokeWallet(_wallet, _erc20Contract, 0, abi.encodeWithSignature("approve(address,uint256)", _spender, _amount));
    }

}