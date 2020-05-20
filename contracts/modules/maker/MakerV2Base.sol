// Copyright (C) 2019  Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity ^0.6.8;

import "../common/BaseModule.sol";
import "../common/RelayerModule.sol";
import "../common/OnlyOwnerModule.sol";
import "../../../lib/maker/MakerInterfaces.sol";
import "../../infrastructure/IMakerRegistry.sol";

/**
 * @title MakerV2Base
 * @dev Common base to MakerV2Invest and MakerV2Loan.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract MakerV2Base is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant private NAME = "MakerV2Manager";

    // The address of the (MCD) DAI token
    GemLike internal daiToken;
    // The address of the SAI <-> DAI migration contract
    address internal scdMcdMigration;
    // The address of the Dai Adapter
    JoinLike internal daiJoin;
    // The address of the Vat
    VatLike internal vat;

    uint256 constant internal RAY = 10 ** 27;

    using SafeMath for uint256;

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        ScdMcdMigrationLike _scdMcdMigration
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        scdMcdMigration = address(_scdMcdMigration);
        daiJoin = _scdMcdMigration.daiJoin();
        daiToken = daiJoin.dai();
        vat = daiJoin.vat();
    }
}