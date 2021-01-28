pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IFilter.sol";
import "../../infrastructure/ITokenPriceRegistry.sol";

interface IParaswap {

    struct Route {
        address payable exchange;
        address targetExchange;
        uint percent;
        bytes payload;
        uint256 networkFee; // only used for 0xV3
    }

    struct Path {
        address to;
        uint256 totalNetworkFee; // only used for 0xV3
        Route[] routes;
    }

    function multiSwap(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        Path[] memory path,
        uint256 mintPrice,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) external payable returns (uint256);
}


contract ParaswapFilter is IFilter {

    bytes32 constant internal MULTISWAP = 0x00000000000000000000000000000000000000000000000000000000cbd1603e;//bytes32(0xcbd1603e); // bytes4(keccak256("multiSwap(address,address,uint256,uint256,uint256,(address,uint256,(address,address,uint256,bytes,uint256)[])[],uint256,address,uint256,string)"))
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;   

    // The token price registry
    ITokenPriceRegistry public tokenPriceRegistry;

    constructor(
        ITokenPriceRegistry _tokenPriceRegistry
    ) 
        public 
    {
        tokenPriceRegistry = _tokenPriceRegistry;
    }

    function validate(bytes calldata _data) external view override returns (bool) {
        (bytes32 sig, address fromToken, address destToken) = abi.decode(abi.encodePacked(bytes28(0),_data), (bytes32, address, address));
        return sig == MULTISWAP && (destToken == ETH_TOKEN || tokenPriceRegistry.isTokenTradable(destToken));
    }
}