// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../contracts/modules/common/BaseFeature.sol";
import "../contracts/modules/common/LimitUtils.sol";

/**
 * @title TestLimitFeature
 * @notice Basic feature to set the daily limit
 */
contract TestLimitFeature is BaseFeature {

    bytes32 constant NAME = "TestLimitModule";

    using SafeMath for uint256;

    ILimitStorage public limitStorage;

    constructor(
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        ILimitStorage _limitStorage,
        IVersionManager _versionManager
    )
        BaseFeature(_registry, _lockStorage, _versionManager, NAME)
        public
    {
        limitStorage = _limitStorage;
    }

    function setLimitAndDailySpent(
        address _wallet,
        uint256 _limit,
        uint256 _alredySpent
    )
        external
    {
        limitStorage.setLimit(_wallet, ILimitStorage.Limit(LimitUtils.safe128(_limit), 0, 0));
        limitStorage.setDailySpent(_wallet, ILimitStorage.DailySpent(LimitUtils.safe128(_alredySpent), LimitUtils.safe64(block.timestamp.add(100))));
    }

    function getDailySpent(address _wallet) external view returns (uint256) {
        ILimitStorage.DailySpent memory dailySpent = limitStorage.getDailySpent(_wallet);
        return dailySpent.alreadySpent;
    }

    function getLimit(address _wallet) external view returns (uint256) {
        ILimitStorage.Limit memory limit = limitStorage.getLimit(_wallet);
        return limit.current;
    }

        /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}