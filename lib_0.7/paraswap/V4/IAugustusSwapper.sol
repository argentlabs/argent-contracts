pragma solidity >=0.6.12;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

interface IAugustusSwapper {

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

    struct BuyData {
        address fromToken;
        address toToken;
        uint256 fromAmount;
        uint256 toAmount;
        address payable beneficiary;
        string referrer;
        bool useReduxToken;
        BuyRoute[] route;
    }

    struct Route {
        address payable exchange;
        address targetExchange;
        uint percent;
        bytes payload;
        uint256 networkFee;//Network fee is associated with 0xv3 trades
    }

    struct MegaSwapPath {
        uint256 fromAmountPercent;
        Path[] path;
    }

    struct Path {
        address to;
        uint256 totalNetworkFee;//Network fee is associated with 0xv3 trades
        Route[] routes;
    }

    struct BuyRoute {
        address payable exchange;
        address targetExchange;
        uint256 fromAmount;
        uint256 toAmount;
        bytes payload;
        uint256 networkFee;//Network fee is associated with 0xv3 trades
    }

    function getPartnerRegistry() external view returns(address);

    function getWhitelistAddress() external view returns(address);

    function getFeeWallet() external view returns(address);

    function getTokenTransferProxy() external view returns (address);

    function paused() external view returns (bool);

    function changeUniswapProxy(address uniswapProxy) external;
    
    function confirmUniswapProxyChange() external;

    function withdrawAllWETH(address) external;
    
    function getTimeLock() external view returns(uint256);

    function initialize(
        address whitelist,
        address reduxToken,
        address partnerRegistry,
        address payable feeWallet,
        address uniswapProxy
    )
        external;

    function initializeAdapter(address adapter, bytes calldata data) external;

    function multiSwap(
        SellData memory data
    )
        external
        payable
        returns (uint256);

    function simpleSwap(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer,
        bool useReduxToken
    )
        external
        payable
        returns (uint256 receivedAmount);

    function swapOnUniswap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint8 referrer
    )
        external
        payable;

    function swapOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint8 referrer
    )
        external
        payable;

    function megaSwap(
        MegaSwapSellData memory data
    )
        external
        payable
        returns (uint256);
}
