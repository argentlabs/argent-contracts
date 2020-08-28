// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "../contracts/modules/maker/MakerV2Manager.sol";

/**
 * @title TestUpgradedMakerV2Manager
 * @notice Test upgraded MakerV2 module.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract TestUpgradedMakerV2Manager is MakerV2Manager {

    MakerV2Manager private previousMakerV2Manager;

    constructor(
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        ScdMcdMigrationLike _scdMcdMigration,
        PotLike _pot,
        JugLike _jug,
        IMakerRegistry _makerRegistry,
        IUniswapFactory _uniswapFactory,
        MakerV2Manager _previousMakerV2Manager,
        IVersionManager _versionManager
    )

        MakerV2Manager(
            _registry,
            _lockStorage,
            _scdMcdMigration,
            _pot,
            _jug,
            _makerRegistry,
            _uniswapFactory,
            _versionManager
        )
        public

    {
        previousMakerV2Manager = _previousMakerV2Manager;
    }

    function isNewVersion(address _addr) external view returns (bytes32) {
        if (_addr == address(previousMakerV2Manager)) {
            return bytes4(keccak256("isNewVersion(address)"));
        }
    }

    function init(address _wallet) public override onlyWallet(_wallet) {
        address[] memory tokens = makerRegistry.getCollateralTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            bytes32 loanId = previousMakerV2Manager.loanIds(_wallet, makerRegistry.getIlk(tokens[i]));
            if (loanId != 0) {
                previousMakerV2Manager.giveVault(_wallet, loanId);
                assignLoanToWallet(_wallet, loanId);
            }
        }
    }
}