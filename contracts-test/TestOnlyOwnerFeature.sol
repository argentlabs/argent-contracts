// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "../contracts/modules/common/OnlyOwnerFeature.sol";

/**
 * @title TestOnlyOwnerFeature
 * @notice Basic test onlyowner module.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TestOnlyOwnerFeature is OnlyOwnerFeature {
    bytes32 constant NAME = "TestOnlyOwnerFeature";
    constructor(
        IModuleRegistry _registry, 
        IGuardianStorage _guardianStorage, 
        IVersionManager _versionManager
    ) 
        BaseFeature(_registry, _guardianStorage, _versionManager, NAME) 
        public 
    {}
}