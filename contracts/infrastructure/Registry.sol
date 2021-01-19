// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

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

import "./base/Owned.sol";
import "./IRegistry.sol";
import "../wallet/base/Configuration.sol";
import "../wallet/base/DataTypes.sol";
import "./IAugustusSwapper.sol";

/**
 * @title Registry implementation
 * @notice Used by the Proxy delegate to resolve registered function signatures against implementation contracts
 * @author Elena Gesheva - <elena@argent.xyz>
 */
contract Registry is IRegistry, Configuration, Owned {

  // Set the all-wallets-wide configuration settings once.
  constructor(
        ITokenPriceRegistry _tokenPriceRegistry,
        address _wethToken,
        IComptroller _comptroller,
        ICompoundRegistry _compoundRegistry,
        address _ckAddress,
        IDexRegistry _dexRegistry,
        address _paraswap,
        string memory _referrer,
        uint256 _lockPeriod,
        uint256 _recoveryPeriod,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint128 _defaultLimit
    )
    {
        tokenPriceRegistry = _tokenPriceRegistry;
        wethToken = _wethToken;

        comptroller = _comptroller;
        compoundRegistry = _compoundRegistry;
        ckAddress = _ckAddress;

        dexRegistry = _dexRegistry;
        paraswapSwapper = _paraswap;
        if(_paraswap != address(0)) {
          paraswapProxy = IAugustusSwapper(_paraswap).getTokenTransferProxy();
        }
        referrer = _referrer;

        lockPeriod = _lockPeriod;
        // For the wallet to be secure we must have recoveryPeriod >= securityPeriod + securityWindow
        // where securityPeriod and securityWindow are the security parameters of adding/removing guardians
        // and confirming large transfers.
        require(_lockPeriod >= _recoveryPeriod, "R: insecure security periods");
        recoveryPeriod = _recoveryPeriod;
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
        defaultLimit = _defaultLimit;
    }

  mapping (bytes4 => address) public pointers;

  function register(
    bytes4 sig,
    address implementation,
    DataTypes.OwnerSignature ownerSigRequirement,
    DataTypes.GuardianSignature guardianSigRequirement) 
  external
  onlyOwner
  {
    pointers[sig] = implementation;
    relaySignatures[sig] = DataTypes.RelaySignatures(ownerSigRequirement, guardianSigRequirement);
  }

  function getImplementation(bytes4 sig) external override view returns(address) {
    return pointers[sig];
  }

  function stringToSig(string memory descriptor) public pure returns(bytes4) {
    return bytes4(keccak256(abi.encodePacked(descriptor)));
  }
}