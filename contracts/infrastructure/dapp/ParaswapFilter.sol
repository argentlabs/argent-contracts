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
import "../base/Owned.sol";
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

    struct MegaSwapPath {
        uint256 fromAmountPercent;
        Path[] path;
    }

    struct MegaSwapSellData {
        address fromToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address payable beneficiary;
        string referrer;
        bool useReduxToken;
        MegaSwapPath[] path;
    }

    function getUniswapProxy() external view returns (address);
}

contract ParaswapFilter is BaseFilter, Owned {

    bytes4 constant internal MULTISWAP = bytes4(keccak256(
        "multiSwap((address,uint256,uint256,uint256,address,string,bool,(address,uint256,(address,address,uint256,bytes,uint256)[])[]))"
    ));
    bytes4 constant internal SIMPLESWAP = bytes4(keccak256(
        "simpleSwap(address,address,uint256,uint256,uint256,address[],bytes,uint256[],uint256[],address,string,bool)"
    ));
    bytes4 constant internal SWAP_ON_UNI = bytes4(keccak256(
        "swapOnUniswap(uint256,uint256,address[],uint8)"
    ));
    bytes4 constant internal SWAP_ON_UNI_FORK = bytes4(keccak256(
        "swapOnUniswapFork(address,bytes32,uint256,uint256,address[],uint8)"
    ));
    bytes4 constant internal MEGASWAP = bytes4(keccak256(
        "megaSwap((address,uint256,uint256,uint256,address,string,bool,(uint256,(address,uint256,(address,address,uint256,bytes,uint256)[])[])[]))"
    ));

    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The token price registry
    address public immutable tokenRegistry;
    // Supported Paraswap adapters
    mapping(address => bool) public adapters;
    // The Dapp registry (used to authorise simpleSwap())
    IAuthoriser public immutable authoriser;
    // Uniswap Proxy used by Paraswap's AugustusSwapper contract
    address public immutable uniswapProxy;

    // Supported Uniswap Fork (factory, initcode) couples.
    // Note that a `mapping(address => bytes32) public supportedInitCodes;` would be cleaner
    // but would cost one storage read to authorise each uni fork swap. 
    address public immutable uniForkFactory1; // sushiswap
    address public immutable uniForkFactory2; // linkswap
    address public immutable uniForkFactory3; // defiswap
    bytes32 public immutable uniForkInitCode1; // sushiswap
    bytes32 public immutable uniForkInitCode2; // linkswap
    bytes32 public immutable uniForkInitCode3; // defiswap

    // Events
    event AdapterAdded(address indexed _adapter);
    event AdapterRemoved(address indexed _adapter);

    constructor(
        address _tokenRegistry,
        IAuthoriser _authoriser,
        address _uniswapProxy,
        address[3] memory _uniFactories,
        bytes32[3] memory _uniInitCodes,
        address[] memory _adapters
    ) public {
        tokenRegistry = _tokenRegistry;
        authoriser = _authoriser;
        uniswapProxy = _uniswapProxy;

        uniForkFactory1 = _uniFactories[0];
        uniForkFactory2 = _uniFactories[1];
        uniForkFactory3 = _uniFactories[2];
        uniForkInitCode1 = _uniInitCodes[0];
        uniForkInitCode2 = _uniInitCodes[1];
        uniForkInitCode3 = _uniInitCodes[2];

        for(uint i = 0; i < _adapters.length; i++) {
            adapters[_adapters[i]] = true;
            emit AdapterAdded(_adapters[i]); 
        }
    }

    /**
     * @notice Add/Remove a DEX adapter to/from the whitelist.
     * @param _adapters array of DEX adapters to add to (or remove from) the whitelist
     * @param _authorised array where each entry is true to add the corresponding DEX to the whitelist, false to remove it
     */
    function setAuthorised(address[] calldata _adapters, bool[] calldata _authorised) external onlyOwner {
        for(uint256 i = 0; i < _adapters.length; i++) {
            if(adapters[_adapters[i]] != _authorised[i]) {
                adapters[_adapters[i]] = _authorised[i];
                if(_authorised[i]) { 
                    emit AdapterAdded(_adapters[i]); 
                } else { 
                    emit AdapterRemoved(_adapters[i]);
                }
            }
        }
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
        if(methodId == SWAP_ON_UNI) {
            return isValidUniSwap(_to, _data);
        }
        if(methodId == SWAP_ON_UNI_FORK) {
            return isValidUniForkSwap(_to, _data);
        }
        if(methodId == MEGASWAP) {
            return isValidMegaSwap(_wallet, _data);
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
        (,address toToken,, address[] memory callees,, uint256[] memory startIndexes,, address beneficiary) 
            = abi.decode(_data[4:], (address, address, uint256[3],address[],bytes,uint256[],uint256[],address));
        return hasValidBeneficiary(_wallet, beneficiary) &&
            hasTradableToken(toToken) &&
            hasAuthorisedCallees(_augustus, callees, startIndexes, _data);
    }

    function isValidUniSwap(address _augustus, bytes calldata _data) internal view returns (bool) {
        if(uniswapProxy != IParaswap(_augustus).getUniswapProxy()) {
            return false;
        }
        (, address[] memory path) = abi.decode(_data[4:], (uint256[2], address[]));
        return hasTradableToken(path[path.length - 1]);
    }

    function isValidUniForkSwap(address _augustus, bytes calldata _data) internal view returns (bool) {
        if(uniswapProxy != IParaswap(_augustus).getUniswapProxy()) {
            return false;
        }
        (address factory, bytes32 initCode,, address[] memory path) = abi.decode(_data[4:], (address, bytes32, uint256[2], address[]));
        return hasTradableToken(path[path.length - 1]) && factory != address(0) && initCode != bytes32(0) && (
            (factory == uniForkFactory1 && initCode == uniForkInitCode1) ||
            (factory == uniForkFactory2 && initCode == uniForkInitCode2) ||
            (factory == uniForkFactory3 && initCode == uniForkInitCode3)
        );
    }

    function isValidMegaSwap(address _wallet, bytes calldata _data) internal view returns (bool) {
        (IParaswap.MegaSwapSellData memory sell) = abi.decode(_data[4:], (IParaswap.MegaSwapSellData));
        return hasValidBeneficiary(_wallet, sell.beneficiary) &&
            hasTradableToken(sell.path[0].path[sell.path[0].path.length - 1].to) && 
            hasValidMegaPath(sell.path);
    }

    function hasAuthorisedCallees(
        address _augustus,
        address[] memory _callees,
        uint256[] memory _startIndexes,
        bytes calldata _data
    )
        internal
        view
        returns (bool)
    {
        // _data = {sig:4}{six params:192}{exchangeDataOffset:32}{...}
        // we add 4+32=36 to the offset to skip the method sig and the size of the exchangeData array
        uint256 exchangeDataOffset = 36 + abi.decode(_data[196:228], (uint256)); 
        address[] memory spenders = new address[](_callees.length);
        bytes[] memory allData = new bytes[](_callees.length);
        for(uint256 i = 0; i < _callees.length; i++) {
            bytes calldata slicedExchangeData = _data[exchangeDataOffset+_startIndexes[i] : exchangeDataOffset+_startIndexes[i+1]];
            allData[i] = slicedExchangeData;
            spenders[i] = Utils.recoverSpender(_callees[i], slicedExchangeData);
        }
        return authoriser.areAuthorised(_augustus, spenders, _callees, allData);
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
        for (uint i = 0; i < _path.length; i++) {
            for (uint j = 0; j < _path[i].routes.length; j++) {
                if(!adapters[_path[i].routes[j].exchange]) {
                    return false;
                }
            }
        }
        return true;
    }

    function hasValidMegaPath(IParaswap.MegaSwapPath[] memory _megaPath) internal view returns (bool) {
        for(uint i = 0; i < _megaPath.length; i++) {
            if(!hasValidExchangeAdapters(_megaPath[i].path)) {
                return false;
            }
        }
        return true;
    }
}