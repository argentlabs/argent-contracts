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

pragma solidity ^0.5.4;
import "../../modules/maker/MakerV2Base.sol";
import "../../modules/maker/MakerV2Invest.sol";

/**
 * @title TestMakerV2Invest
 * @dev Module to test MakerV2Invest on its own
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract TestMakerV2Invest is MakerV2Base, MakerV2Invest {

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        ScdMcdMigrationLike _scdMcdMigration,
        PotLike _pot
    )
        MakerV2Base(_registry, _guardianStorage, _scdMcdMigration)
        MakerV2Invest(_pot)
        public
    {
    }

}