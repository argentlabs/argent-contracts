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

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "./BaseFeature.sol";

/**
 * @title OnlyOwnerFeature
 * @notice Base contract for features where the execute() method must be called with one signature from the owner.
 * @author Julien Niset - <julien@argent.xyz>
 */
abstract contract OnlyOwnerFeature is BaseFeature {

   /**
    * @notice Returns a constant that indicates that the feature is an OnlyOwnerFeature.
    * @return The constant bytes4(keccak256("isOnlyOwnerFeature()"))
    */
    function isOnlyOwnerFeature() external pure returns (bytes4) {
        return this.isOnlyOwnerFeature.selector;
    }

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external virtual view override returns (uint256, OwnerSignature) {
        return (1, OwnerSignature.Required);
    }
}