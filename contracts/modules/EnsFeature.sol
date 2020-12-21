// Copyright (C) 2020  Argent Labs Ltd. <https://argent.xyz>

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

import "./common/BaseFeature.sol";
import "../infrastructure/ens/IENSManager.sol";

/**
 * @title EnsManagerFeature
 * @notice Feature to manage wallet's ENS record.
 */
contract EnsFeature is BaseFeature {
  bytes32 constant NAME = "EnsFeature";

  // The address of the ENS manager
  address public ensManager;

  constructor(ILockStorage _lockStorage,
        IVersionManager _versionManager,
        address _ensManager
    )
        BaseFeature(_lockStorage, _versionManager, NAME)
        public
    {
        ensManager = _ensManager;
    }

  modifier validateENSLabel(string memory _label) {
      bytes memory labelBytes = bytes(_label);
      require(labelBytes.length != 0, "EF: ENS label must be defined");
      _;
    }

  function registerWalletENS(address payable _wallet, string memory _label) external validateENSLabel(_label) {
    // claim reverse
    address ensResolver = IENSManager(ensManager).ensResolver();
    bytes memory methodData = abi.encodeWithSignature("claimWithResolver(address,address)", ensManager, ensResolver);
    address ensReverseRegistrar = IENSManager(ensManager).getENSReverseRegistrar();
    invokeWallet(_wallet, ensReverseRegistrar, 0, methodData);
    // register with ENS manager
    IENSManager(ensManager).register(_label, _wallet);
  }

  /**
  * @inheritdoc IFeature
  */
  function getRequiredSignatures(address, bytes calldata) external view override returns (uint256, OwnerSignature) {
    return (1, OwnerSignature.Required);
  }
}