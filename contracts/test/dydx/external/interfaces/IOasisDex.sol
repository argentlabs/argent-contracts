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


/**
 * @title IOasisDex
 * @author dYdX
 *
 * Interface for the OasisDex contract
 */
interface IOasisDex {

    // ============ Structs ================

    struct OfferInfo {
        uint256 pay_amt;
        address pay_gem;
        uint256 buy_amt;
        address buy_gem;
        address owner;
        uint64 timestamp;
    }

    struct SortInfo {
        uint256 next;  //points to id of next higher offer
        uint256 prev;  //points to id of previous lower offer
        uint256 delb;  //the blocknumber where this entry was marked for delete
    }

    // ============ Storage Getters ================

    function last_offer_id()
        external
        view
        returns (uint256);

    function offers(
        uint256 id
    )
        external
        view
        returns (OfferInfo memory);

    function close_time()
        external
        view
        returns (uint64);

    function stopped()
        external
        view
        returns (bool);

    function buyEnabled()
        external
        view
        returns (bool);

    function matchingEnabled()
        external
        view
        returns (bool);

    function _rank(
        uint256 id
    )
        external
        view
        returns (SortInfo memory);

    function _best(
        address sell_gem,
        address buy_gem
    )
        external
        view
        returns (uint256);

    function _span(
        address sell_gem,
        address buy_gem
    )
        external
        view
        returns (uint256);

    function _dust(
        address gem
    )
        external
        view
        returns (uint256);

    function _near(
        uint256 id
    )
        external
        view
        returns (uint256);

    // ============ Constant Functions ================

    function isActive(
        uint256 id
    )
        external
        view
        returns (bool);

    function getOwner(
        uint256 id
    )
        external
        view
        returns (address);

    function getOffer(
        uint256 id
    )
        external
        view
        returns (uint256, address, uint256, address);

    function getMinSell(
        address pay_gem
    )
        external
        view
        returns (uint256);

    function getBestOffer(
        address sell_gem,
        address buy_gem
    )
        external
        view
        returns (uint256);

    function getWorseOffer(
        uint256 id
    )
        external
        view
        returns (uint256);

    function getBetterOffer(
        uint256 id
    )
        external
        view
        returns (uint256);

    function getOfferCount(
        address sell_gem,
        address buy_gem
    )
        external
        view
        returns (uint256);

    function getFirstUnsortedOffer()
        external
        view
        returns (uint256);

    function getNextUnsortedOffer(
        uint256 id
    )
        external
        view
        returns (uint256);

    function isOfferSorted(
        uint256 id
    )
        external
        view
        returns (bool);

    function getBuyAmount(
        address buy_gem,
        address pay_gem,
        uint256 pay_amt
    )
        external
        view
        returns (uint256);

    function getPayAmount(
        address pay_gem,
        address buy_gem,
        uint256 buy_amt
    )
        external
        view
        returns (uint256);

    function isClosed()
        external
        view
        returns (bool);

    function getTime()
        external
        view
        returns (uint64);

    // ============ Non-Constant Functions ================

    function bump(
        bytes32 id_
    )
        external;

    function buy(
        uint256 id,
        uint256 quantity
    )
        external
        returns (bool);

    function cancel(
        uint256 id
    )
        external
        returns (bool);

    function kill(
        bytes32 id
    )
        external;

    function make(
        address  pay_gem,
        address  buy_gem,
        uint128  pay_amt,
        uint128  buy_amt
    )
        external
        returns (bytes32);

    function take(
        bytes32 id,
        uint128 maxTakeAmount
    )
        external;

    function offer(
        uint256 pay_amt,
        address pay_gem,
        uint256 buy_amt,
        address buy_gem
    )
        external
        returns (uint256);

    function offer(
        uint256 pay_amt,
        address pay_gem,
        uint256 buy_amt,
        address buy_gem,
        uint256 pos
    )
        external
        returns (uint256);

    function offer(
        uint256 pay_amt,
        address pay_gem,
        uint256 buy_amt,
        address buy_gem,
        uint256 pos,
        bool rounding
    )
        external
        returns (uint256);

    function insert(
        uint256 id,
        uint256 pos
    )
        external
        returns (bool);

    function del_rank(
        uint256 id
    )
        external
        returns (bool);

    function sellAllAmount(
        address pay_gem,
        uint256 pay_amt,
        address buy_gem,
        uint256 min_fill_amount
    )
        external
        returns (uint256);

    function buyAllAmount(
        address buy_gem,
        uint256 buy_amt,
        address pay_gem,
        uint256 max_fill_amount
    )
        external
        returns (uint256);
}
