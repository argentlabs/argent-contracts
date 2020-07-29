pragma solidity ^0.7.0;
import "../contracts/wallet/BaseWallet.sol";
import "../contracts/modules/common/BaseFeature.sol";
import "../contracts/infrastructure/storage/ILockStorage.sol";

// SPDX-License-Identifier: GPL-3.0-only
contract ERC20Approver is BaseFeature {

    bytes32 constant NAME = "ERC20Approver";

    constructor(IVersionManager _versionManager) BaseFeature(ILockStorage(0), _versionManager, NAME) public {}

    // used by NftTransfer's Tests
    function approveERC20(address _wallet, address _erc20Contract, address _spender, uint256 _amount)
        external
        onlyWalletOwnerOrFeature(_wallet)
    {
        invokeWallet(_wallet, _erc20Contract, 0, abi.encodeWithSignature("approve(address,uint256)", _spender, _amount));
    }

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address, bytes calldata) external view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}