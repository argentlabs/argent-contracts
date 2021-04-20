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
pragma solidity ^0.8.3;

import "../BaseFilter.sol";
import "./ParaswapUtils.sol";
import "../../IAuthoriser.sol";
import "../../../modules/common/Utils.sol";

interface IUniswapV1Factory {
    function getExchange(address token) external view returns (address);
}

interface IParaswapUniswapProxy {
    function UNISWAP_FACTORY() external view returns (address);
    function UNISWAP_INIT_CODE() external view returns (bytes32);
    function WETH() external view returns (address);
}

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

    struct UniswapV2Data {
        address[] path;
    }

    function getUniswapProxy() external view returns (address);
}

contract ParaswapFilter is BaseFilter {

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

    // The token registry
    address public immutable tokenRegistry;
    // Paraswap entrypoint
    address public immutable augustus;
    // Supported Paraswap targetExchanges
    mapping(address => bool) public targetExchanges;
    // Supported ParaswapPool market makers
    mapping(address => bool) public marketMakers;
    // The supported adapters
    address public immutable uniV1Adapter;
    address public immutable uniV2Adapter;
    address public immutable sushiswapAdapter;
    address public immutable linkswapAdapter;
    address public immutable defiswapAdapter;
    address public immutable zeroExV2Adapter;
    address public immutable zeroExV4Adapter;
    address public immutable curveAdapter;
    // The Dapp registry (used to authorise simpleSwap())
    IAuthoriser public immutable authoriser;
    // Uniswap Proxy used by Paraswap's AugustusSwapper contract
    address public immutable uniswapProxy;
    // Whether the uniswap proxy has been changed -> needs manual update
    bool public isValidUniswapProxy = true;
    // WETH address
    address public immutable weth;

    // Supported Uniswap Fork (factory, initcode) couples.
    // Note that a `mapping(address => bytes32) public supportedInitCodes;` would be cleaner
    // but would cost one storage read to authorise each uni fork swap.
    address public immutable uniFactory; // uniswap
    address public immutable uniForkFactory1; // sushiswap
    address public immutable uniForkFactory2; // linkswap
    address public immutable uniForkFactory3; // defiswap
    bytes32 public immutable uniInitCode; // uniswap
    bytes32 public immutable uniForkInitCode1; // sushiswap
    bytes32 public immutable uniForkInitCode2; // linkswap
    bytes32 public immutable uniForkInitCode3; // defiswap

    constructor(
        address _tokenRegistry,
        IAuthoriser _authoriser,
        address _augustus,
        address _uniswapProxy,
        address[3] memory _uniFactories,
        bytes32[3] memory _uniInitCodes,
        address[8] memory _adapters,
        address[] memory _targetExchanges,
        address[] memory _marketMakers
    ) {
        tokenRegistry = _tokenRegistry;
        authoriser = _authoriser;
        augustus = _augustus;
        uniswapProxy = _uniswapProxy;
        weth = IParaswapUniswapProxy(_uniswapProxy).WETH();
        uniFactory = IParaswapUniswapProxy(_uniswapProxy).UNISWAP_FACTORY();
        uniInitCode = IParaswapUniswapProxy(_uniswapProxy).UNISWAP_INIT_CODE();
        uniForkFactory1 = _uniFactories[0];
        uniForkFactory2 = _uniFactories[1];
        uniForkFactory3 = _uniFactories[2];
        uniForkInitCode1 = _uniInitCodes[0];
        uniForkInitCode2 = _uniInitCodes[1];
        uniForkInitCode3 = _uniInitCodes[2];
        uniV1Adapter = _adapters[0];
        uniV2Adapter = _adapters[1];
        sushiswapAdapter = _adapters[2];
        linkswapAdapter = _adapters[3];
        defiswapAdapter = _adapters[4];
        zeroExV2Adapter = _adapters[5];
        zeroExV4Adapter = _adapters[6];
        curveAdapter = _adapters[7];
        for(uint i = 0; i < _targetExchanges.length; i++) {
            targetExchanges[_targetExchanges[i]] = true;
        }
        for(uint i = 0; i < _marketMakers.length; i++) {
            marketMakers[_marketMakers[i]] = true;
        }
    }

    function updateIsValidUniswapProxy() external {
        isValidUniswapProxy = (uniswapProxy == IParaswap(augustus).getUniswapProxy());
    }

    function isValid(address _wallet, address /*_spender*/, address _to, bytes calldata _data) external view override returns (bool valid) {
        // disable ETH transfer & unsupported Paraswap entrypoints
        if (_data.length < 4 || _to != augustus) {
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
            return isValidUniSwap(_data);
        }
        if(methodId == SWAP_ON_UNI_FORK) {
            return isValidUniForkSwap(_data);
        }
        if(methodId == MEGASWAP) {
            return isValidMegaSwap(_wallet, _data);
        }
        return false;
    }

    function isValidMultiSwap(address _wallet, bytes calldata _data) internal view returns (bool) {
        (IParaswap.SellData memory sell) = abi.decode(_data[4:], (IParaswap.SellData));
        return hasValidBeneficiary(_wallet, sell.beneficiary) && hasValidPath(sell.fromToken, sell.path);
    }

    function isValidSimpleSwap(address _wallet, address _augustus, bytes calldata _data) internal view returns (bool) {
        (,address toToken,, address[] memory callees,, uint256[] memory startIndexes,, address beneficiary) 
            = abi.decode(_data[4:], (address, address, uint256[3],address[],bytes,uint256[],uint256[],address));
        return hasValidBeneficiary(_wallet, beneficiary) &&
            hasTradableToken(toToken) &&
            hasAuthorisedCallees(_augustus, callees, startIndexes, _data);
    }

    function isValidUniSwap(bytes calldata _data) internal view returns (bool) {
        if(!isValidUniswapProxy) {
            return false;
        }
        (, address[] memory path) = abi.decode(_data[4:], (uint256[2], address[]));
        return ParaswapUtils.hasValidUniV2Path(path, tokenRegistry, uniFactory, uniInitCode, weth);
    }

    function isValidUniForkSwap(bytes calldata _data) internal view returns (bool) {
        if(!isValidUniswapProxy) {
            return false;
        }
        (address factory, bytes32 initCode,, address[] memory path) = abi.decode(_data[4:], (address, bytes32, uint256[2], address[]));
        return factory != address(0) && initCode != bytes32(0) && (
            (
                factory == uniForkFactory1 &&
                initCode == uniForkInitCode1 &&
                ParaswapUtils.hasValidUniV2Path(path, tokenRegistry, uniForkFactory1, uniForkInitCode1, weth)
            ) || (
                factory == uniForkFactory2 &&
                initCode == uniForkInitCode2 &&
                ParaswapUtils.hasValidUniV2Path(path, tokenRegistry, uniForkFactory2, uniForkInitCode2, weth)
            ) || (
                factory == uniForkFactory3 &&
                initCode == uniForkInitCode3 &&
                ParaswapUtils.hasValidUniV2Path(path, tokenRegistry, uniForkFactory3, uniForkInitCode3, weth)
            )
        );
    }

    function isValidMegaSwap(address _wallet, bytes calldata _data) internal view returns (bool) {
        (IParaswap.MegaSwapSellData memory sell) = abi.decode(_data[4:], (IParaswap.MegaSwapSellData));
        return hasValidBeneficiary(_wallet, sell.beneficiary) && hasValidMegaPath(sell.fromToken, sell.path);
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
        if(_destToken == ParaswapUtils.ETH_TOKEN) {
            return true;
        }
        (bool success, bytes memory res) = tokenRegistry.staticcall(abi.encodeWithSignature("isTokenTradable(address)", _destToken));
        return success && abi.decode(res, (bool));
    }

    function hasValidPath(address _fromToken, IParaswap.Path[] memory _path) internal view returns (bool) {
        for (uint i = 0; i < _path.length; i++) {
            for (uint j = 0; j < _path[i].routes.length; j++) {
                if(!hasValidRoute(_path[i].routes[j], (i == 0) ? _fromToken : _path[i-1].to, _path[i].to)) {
                    return false;
                }
            }
        }
        return true;
    }

    function hasValidRoute(IParaswap.Route memory _route, address _fromToken, address _toToken) internal view returns (bool) {
        if(_route.targetExchange != address(0) && !targetExchanges[_route.targetExchange]) {
            return false;
        }
        if(_route.exchange == uniV2Adapter) { 
            return hasValidUniV2Route(_route.payload, uniFactory, uniInitCode);
        } 
        if(_route.exchange == sushiswapAdapter) { 
            return hasValidUniV2Route(_route.payload, uniForkFactory1, uniForkInitCode1);
        }
        if(_route.exchange == zeroExV4Adapter) { 
            return hasValidZeroExV4Route(_route.payload);
        }
        if(_route.exchange == zeroExV2Adapter) { 
            return hasValidZeroExV2Route(_route.payload);
        }
        if(_route.exchange == curveAdapter) { 
            return true;
        }
        if(_route.exchange == linkswapAdapter) { 
            return hasValidUniV2Route(_route.payload, uniForkFactory2, uniForkInitCode2);
        }
        if(_route.exchange == defiswapAdapter) { 
            return hasValidUniV2Route(_route.payload, uniForkFactory3, uniForkInitCode3);
        }
        if(_route.exchange == uniV1Adapter) { 
            return hasValidUniV1Route(_route.targetExchange, _fromToken, _toToken);
        }
        return false;  
    }

    function hasValidUniV2Route(bytes memory _payload, address _factory, bytes32 _initCode) internal view returns (bool) {
        IParaswap.UniswapV2Data memory data = abi.decode(_payload, (IParaswap.UniswapV2Data));
        return ParaswapUtils.hasValidUniV2Path(data.path, tokenRegistry, _factory, _initCode, weth);
    }

    function hasValidUniV1Route(address _uniV1Factory, address _fromToken, address _toToken) internal view returns (bool) {
        address pool = IUniswapV1Factory(_uniV1Factory).getExchange(_fromToken == ParaswapUtils.ETH_TOKEN ? _toToken : _fromToken);
        return hasTradableToken(pool);
    }

    function hasValidZeroExV4Route(bytes memory _payload) internal view returns (bool) {
        ParaswapUtils.ZeroExV4Data memory data = abi.decode(_payload, (ParaswapUtils.ZeroExV4Data));
        return marketMakers[data.order.maker];
    }

    function hasValidZeroExV2Route(bytes memory _payload) internal view returns (bool) {
        ParaswapUtils.ZeroExV2Data memory data = abi.decode(_payload, (ParaswapUtils.ZeroExV2Data));
        for(uint i = 0; i < data.orders.length; i++) {
            if(!marketMakers[data.orders[i].makerAddress]) {
                return false;
            }
        }
        return true;
    }

    function hasValidMegaPath(address _fromToken, IParaswap.MegaSwapPath[] memory _megaPath) internal view returns (bool) {
        for(uint i = 0; i < _megaPath.length; i++) {
            if(!hasValidPath(_fromToken, _megaPath[i].path)) {
                return false;
            }
        }
        return true;
    }
}