/*

    Copyright 2019 dYdX Trading Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.5.7;
pragma experimental ABIEncoderV2;

import { Monetary } from "./Monetary.sol";
import { Storage } from "./Storage.sol";


/**
 * @title Cache
 * @author dYdX
 *
 * Library for caching information about markets
 */
library Cache {
    using Cache for MarketCache;
    using Storage for Storage.State;

    // ============ Structs ============

    struct MarketInfo {
        bool isClosing;
        uint128 borrowPar;
        Monetary.Price price;
    }

    struct MarketCache {
        MarketInfo[] markets;
    }

    // ============ Setter Functions ============

    /**
     * Initialize an empty cache for some given number of total markets.
     */
    function create(
        uint256 numMarkets
    )
        internal
        pure
        returns (MarketCache memory)
    {
        return MarketCache({
            markets: new MarketInfo[](numMarkets)
        });
    }

    /**
     * Add market information (price and total borrowed par if the market is closing) to the cache.
     * Return true if the market information did not previously exist in the cache.
     */
    function addMarket(
        MarketCache memory cache,
        Storage.State storage state,
        uint256 marketId
    )
        internal
        view
        returns (bool)
    {
        if (cache.hasMarket(marketId)) {
            return false;
        }
        cache.markets[marketId].price = state.fetchPrice(marketId);
        if (state.markets[marketId].isClosing) {
            cache.markets[marketId].isClosing = true;
            cache.markets[marketId].borrowPar = state.getTotalPar(marketId).borrow;
        }
        return true;
    }

    // ============ Getter Functions ============

    function getNumMarkets(
        MarketCache memory cache
    )
        internal
        pure
        returns (uint256)
    {
        return cache.markets.length;
    }

    function hasMarket(
        MarketCache memory cache,
        uint256 marketId
    )
        internal
        pure
        returns (bool)
    {
        return cache.markets[marketId].price.value != 0;
    }

    function getIsClosing(
        MarketCache memory cache,
        uint256 marketId
    )
        internal
        pure
        returns (bool)
    {
        return cache.markets[marketId].isClosing;
    }

    function getPrice(
        MarketCache memory cache,
        uint256 marketId
    )
        internal
        pure
        returns (Monetary.Price memory)
    {
        return cache.markets[marketId].price;
    }

    function getBorrowPar(
        MarketCache memory cache,
        uint256 marketId
    )
        internal
        pure
        returns (uint128)
    {
        return cache.markets[marketId].borrowPar;
    }
}
