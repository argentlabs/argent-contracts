// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
import "../contracts/modules/common/BaseFeature.sol";

contract BadFeature is BaseFeature {

    constructor(
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        IVersionManager _versionManager
    ) public BaseFeature(_registry, _lockStorage, _versionManager, "") {}

    uint uintVal;
    function setIntOwnerOnly(address _wallet, uint _val) external {
        uintVal = _val;
    }

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external view override returns (uint256, OwnerSignature) {
        return (0, OwnerSignature.Required);
    }
}