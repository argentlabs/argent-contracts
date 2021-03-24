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

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./BaseFilter.sol";
import "../IAuthoriser.sol";
import "../../modules/common/Utils.sol";

interface IParaswap {
    struct Route {
        address payable exchange;
        address targetExchange;
        uint256 percent;
        bytes payload;
        uint256 networkFee;
    }

    struct Path {
        address to;
        uint256 totalNetworkFee;
        Route[] routes;
    }

    struct SellData {
        address fromToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address payable beneficiary;
        string referrer;
        bool useReduxToken;
        Path[] path;
    }
}

contract ParaswapFilter is BaseFilter {

    bytes4 constant internal MULTISWAP = bytes4(keccak256(
        "multiSwap((address,uint256,uint256,uint256,address,string,bool,(address,uint256,(address,address,uint256,bytes,uint256)[])[]))"
    ));
    bytes4 constant internal SIMPLESWAP = bytes4(keccak256(
        "simpleSwap(address,address,uint256,uint256,uint256,address[],bytes,uint256[],uint256[],address,string,bool)"
    ));
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The token registry
    address public immutable tokenRegistry;
    // The DEX registry
    address public immutable dexRegistry;
    // The Dapp registry (used to authorise simpleSwap())
    IAuthoriser public immutable authoriser;

    constructor(address _tokenRegistry, address _dexRegistry, IAuthoriser _authoriser) public {
        tokenRegistry = _tokenRegistry;
        dexRegistry = _dexRegistry;
        authoriser = _authoriser;
    }

    function isValid(address _wallet, address /*_spender*/, address _to, bytes calldata _data) external view override returns (bool) {
        // disable ETH transfer
        if (_data.length < 4) {
            return false;
        }
        bytes4 methodId = getMethod(_data);
        if(methodId == MULTISWAP) {
            return isValidMultiSwap(_wallet, _data);
        } 
        if(methodId == SIMPLESWAP) {
            return isValidSimpleSwap(_wallet, _to, _data);
        }
        return false;
    }

    function isValidMultiSwap(address _wallet, bytes calldata _data) internal view returns (bool) {
        (IParaswap.SellData memory sell) = abi.decode(_data[4:], (IParaswap.SellData));
        return hasValidBeneficiary(_wallet, sell.beneficiary) &&
            hasTradableToken(sell.path[sell.path.length - 1].to) && 
            hasValidExchangeAdapters(sell.path);
    }

    function isValidSimpleSwap(address _wallet, address _augustus, bytes calldata _data) internal view returns (bool) {
        (, address[] memory callees,, uint256[] memory startIndexes,, address beneficiary) 
            = abi.decode(_data[4:], (uint256[5],address[],bytes,uint256[],uint256[],address));
        return hasValidBeneficiary(_wallet, beneficiary) && hasAuthorisedCallees(_augustus, callees, startIndexes, _data);
    }

    function hasAuthorisedCallees(address _augustus, address[] memory _callees, uint256[] memory _startIndexes, bytes calldata _data) internal returns (bool) {
        // _data = {sig:4}{six params:192}{exchangeDataOffset:32}{...}
        // we add 4+32=36 to the offset to skip the method sig and the size of the exchangeData array
        uint256 exchangeDataOffset = 36 + abi.decode(_data[196:228], (uint256)); 
        for(uint256 i = 0; i < _callees.length; i++) {
            bytes calldata slicedExchangeData = _data[exchangeDataOffset+_startIndexes[i] : exchangeDataOffset+_startIndexes[i+1]];
            address spender = Utils.recoverSpender(_augustus, _callees[i], slicedExchangeData);
            if(!authoriser.isAuthorised(_augustus, spender, _callees[i], slicedExchangeData)) {
                return false;
            }
        }
        return true;
    }

    function hasValidBeneficiary(address _wallet, address _beneficiary) internal pure returns (bool) {
        return (_beneficiary == address(0) || _beneficiary == _wallet);
    }

    function hasTradableToken(address _destToken) internal view returns (bool) {
        if(_destToken == ETH_TOKEN) {
            return true;
        }
        (bool success, bytes memory res) = tokenRegistry.staticcall(abi.encodeWithSignature("isTokenTradable(address)", _destToken));
        return success && abi.decode(res, (bool));
    }

    function hasValidExchangeAdapters(IParaswap.Path[] memory _path) internal view returns (bool) {
        (bool success,) = dexRegistry.staticcall(
            abi.encodeWithSignature("verifyExchangeAdapters((address,uint256,(address,address,uint256,bytes,uint256)[])[])", _path)
        );
        return success;
    }
}