// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.s

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./BaseFilter.sol";

interface IParaswap {
    struct Route {
        address payable exchange;
        address targetExchange;
        uint percent;
        bytes payload;
        uint256 networkFee;
    }

    struct Path {
        address to;
        uint256 totalNetworkFee;
        Route[] routes;
    }
}

contract ParaswapFilter is BaseFilter {

    bytes4 constant internal MULTISWAP = 0xcbd1603e; // bytes4(keccak256("multiSwap(...)"))
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The token price registry
    address public immutable tokenPriceRegistry;
    // The DEX registry
    address public immutable dexRegistry;

    constructor(address _tokenPriceRegistry, address _dexRegistry) public {
        tokenPriceRegistry = _tokenPriceRegistry;
        dexRegistry = _dexRegistry;
    }

    function isValid(address _wallet, address /*_spender*/, address /*_to*/, bytes calldata _data) external view override returns (bool) {
        return isMultiSwap(_data) && hasValidBeneficiary(_wallet, _data) && hasTradableToken(_data) && hasValidExchangeAdapters(_data);
    }

    function isMultiSwap(bytes calldata _data) internal pure returns (bool) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }
        return getMethod(_data) == MULTISWAP;
    }

    function hasValidBeneficiary(address _wallet, bytes calldata _data) internal pure returns (bool) {
        (address beneficiary) = abi.decode(_data[228:], (address)); // skipping 4 + 7*32 = 228 bytes
        return (beneficiary == address(0) || beneficiary == _wallet);
    }

    function hasTradableToken(bytes calldata _data) internal view returns (bool) {
        (, address _destToken) = abi.decode(_data[4:], (address, address));   
        if(_destToken == ETH_TOKEN) {
            return true;
        }
        (bool success, bytes memory res) = tokenPriceRegistry.staticcall(abi.encodeWithSignature("isTokenTradable(address)", _destToken));
        return success && abi.decode(res, (bool));
    }

    function hasValidExchangeAdapters(bytes calldata _data) internal view returns (bool) {
        // Note: using uint256[5] instead of (address, address, uint, uint, uint) to avoid "stack too deep" issues
        (,IParaswap.Path[] memory path) = abi.decode(_data[4:], (uint256[5], IParaswap.Path[]));
        (bool success,) = dexRegistry.staticcall(
            abi.encodeWithSignature("verifyExchangeAdapters((address,uint256,(address,address,uint256,bytes,uint256)[])[])", path)
        );
        return success;
    }
}