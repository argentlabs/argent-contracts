// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "../base/Utils.sol";
import "../base/BaseTransfer.sol";
import "./IApprovedTransfer.sol";

/**
 * @title ApprovedTransfer
 * @notice Feature to transfer tokens (ETH or ERC20) or call third-party contracts with the approval of guardians.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract ApprovedTransfer is IApprovedTransfer, BaseTransfer {
    /**
    * @inheritdoc IApprovedTransfer
    */
    function transferTokenApproved(
        address _token,
        address payable _to,
        uint256 _amount,
        bytes calldata _data
    )
        external override
        onlyWhenUnlocked()
    {
        doTransfer(_token, _to, _amount, _data);
        resetDailySpent();
    }

    /**
    * @inheritdoc IApprovedTransfer
    */
    function callContractApproved(
        address _contract,
        uint256 _value,
        bytes calldata _data
    )
        external override
        onlyWhenUnlocked()
        onlyAuthorisedContractCall(_contract)
    {
        doCallContract(_contract, _value, _data);
        resetDailySpent();
    }

    /**
    * @inheritdoc IApprovedTransfer
    */
    function approveTokenAndCallContractApproved(
        address _token,
        address _spender,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external override
        onlyWhenUnlocked()
        onlyAuthorisedContractCall(_contract)
    {
        doApproveTokenAndCallContract(_token, _spender, _amount, _contract, _data);
        resetDailySpent();
    }

    /**
    * @inheritdoc IApprovedTransfer
    */
    function changeLimitApproved(uint256 _newLimit) external override
    onlyWhenUnlocked()
    {
        uint128 targetLimit = Utils.safe128(_newLimit);
        uint64 changeAfter = Utils.safe64(block.timestamp);
        limit = Limit(targetLimit, targetLimit, changeAfter);

        resetDailySpent();
        emit LimitChanged(address(this), _newLimit, changeAfter);
    }

    /**
    * @inheritdoc IApprovedTransfer
    */
    function approveWethAndCallContractApproved(
        address _spender,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external override
        onlyWhenUnlocked()
        onlyAuthorisedContractCall(_contract)
    {
        doApproveWethAndCallContract(_spender, _amount, _contract, _data);
        resetDailySpent();
    }

    /**
    * @notice Helper method to Reset the daily consumption.
    */
    function resetDailySpent() private 
    onlyWhenUnlocked()
    {
        dailySpent = DailySpent(uint128(0), uint64(0));
    }
}