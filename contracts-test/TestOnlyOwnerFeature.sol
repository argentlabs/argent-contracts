// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "../contracts/modules/common/BaseFeature.sol";

/**
 * @title TestOnlyOwnerFeature
 * @notice Basic test onlyowner module.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TestOnlyOwnerFeature is BaseFeature {
    bytes32 constant NAME = "TestOnlyOwnerFeature";
    constructor(
        IModuleRegistry _registry, 
        ILockStorage _lockStorage, 
        IVersionManager _versionManager
    ) 
        BaseFeature(_registry, _lockStorage, _versionManager, NAME) 
        public 
    {}

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address, bytes calldata) external view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}