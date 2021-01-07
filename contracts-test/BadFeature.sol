// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;
import "../contracts/modules/common/BaseModule.sol";

contract BadFeature is BaseModule {

    constructor(
        ILockStorage _lockStorage,
        IVersionManager _versionManager
    ) public BaseModule(_lockStorage, _versionManager, "") {}

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