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

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IErc20 } from "../protocol/interfaces/IErc20.sol";
import { Math } from "../protocol/lib/Math.sol";


/**
 * @title TestOasisDex
 * @author dYdX
 *
 * Contract for testing stuff against OasisDex. Removes some functionality like auth, note, and
 * non-reentrancy protection.
 */
contract TestOasisDex {
    // ============ Constants ============

    uint256 constant WAD = 10 ** 18;
    uint256 constant RAY = 10 ** 27;

    // ============ Events ============

    event LogItemUpdate(uint256 id);
    event LogTrade(
        uint256 pay_amt,
        address indexed pay_gem,
        uint256 buy_amt,
        address indexed buy_gem
    );
    event LogMake(
        bytes32  indexed  id,
        bytes32  indexed  pair,
        address  indexed  maker,
        address             pay_gem,
        address             buy_gem,
        uint128           pay_amt,
        uint128           buy_amt,
        uint64            timestamp
    );
    event LogBump(
        bytes32  indexed  id,
        bytes32  indexed  pair,
        address  indexed  maker,
        address             pay_gem,
        address             buy_gem,
        uint128           pay_amt,
        uint128           buy_amt,
        uint64            timestamp
    );
    event LogTake(
        bytes32           id,
        bytes32  indexed  pair,
        address  indexed  maker,
        address             pay_gem,
        address             buy_gem,
        address  indexed  taker,
        uint128           take_amt,
        uint128           give_amt,
        uint64            timestamp
    );
    event LogKill(
        bytes32  indexed  id,
        bytes32  indexed  pair,
        address  indexed  maker,
        address             pay_gem,
        address             buy_gem,
        uint128           pay_amt,
        uint128           buy_amt,
        uint64            timestamp
    );
    event LogBuyEnabled(bool isEnabled);
    event LogMinSell(address pay_gem, uint256 min_amount);
    event LogMatchingEnabled(bool isEnabled);
    event LogUnsortedOffer(uint256 id);
    event LogSortedOffer(uint256 id);
    event LogAddTokenPairWhitelist(address baseToken, address quoteToken);
    event LogRemTokenPairWhitelist(address baseToken, address quoteToken);
    event LogInsert(address keeper, uint256 id);
    event LogDelete(address keeper, uint256 id);

    // ============ Structs ============

    struct OfferInfo {
        uint256 pay_amt;
        address pay_gem;
        uint256 buy_amt;
        address buy_gem;
        address owner;
        uint64 timestamp;
    }

    struct sortInfo {
        uint256 next;  //points to id of next higher offer
        uint256 prev;  //points to id of previous lower offer
        uint256 delb;  //the blocknumber where this entry was marked for delete
    }

    // ============ Storage ============

    bool public stopped;
    bool public buyEnabled = true;
    bool public matchingEnabled = true;
    mapping(uint256 => sortInfo) public _rank;
    mapping(address => mapping(address => uint256)) public _best;
    mapping(address => mapping(address => uint256)) public _span;
    mapping(address => uint256) public _dust;
    mapping(uint256 => uint256) public _near;
    uint256 _head;
    uint256 public dustId;
    uint256 public last_offer_id;
    mapping (uint256 => OfferInfo) public offers;

    // ============ Modifiers ============

    modifier can_offer {
        require(!isClosed());
        _;
    }

    modifier can_buy(uint256 id) {
        require(isActive(id));
        require(!isClosed());
        _;
    }

    modifier can_cancel(uint256 id) {
        require(isActive(id), "Offer was deleted or taken, or never existed.");
        require(
            isClosed() || msg.sender == getOwner(id) || id == dustId,
            "Offer can not be cancelled because user is not owner, and market is open, and offer sells required amount of tokens."
        );
        _;
    }

    // ============ Functions ============

    function isClosed() public view returns (bool closed) {
        return stopped;
    }

    function getTime() public view returns (uint64) {
        return uint64(now);
    }

    function stop() public {
        stopped = true;
    }

    function isActive(uint256 id) public view returns (bool active) {
        return offers[id].timestamp > 0;
    }

    function getOwner(uint256 id) public view returns (address owner) {
        return offers[id].owner;
    }

    function getOffer(uint256 id) public view returns (uint256, address, uint256, address) {
        OfferInfo memory _offer = offers[id];
        return (_offer.pay_amt, _offer.pay_gem,
              _offer.buy_amt, _offer.buy_gem);
    }

    function bump(bytes32 id_)
        public
        can_buy(uint256(id_))
    {
        uint256 id = uint256(id_);
        emit LogBump(
            id_,
            keccak256(abi.encodePacked(offers[id].pay_gem, offers[id].buy_gem)),
            offers[id].owner,
            offers[id].pay_gem,
            offers[id].buy_gem,
            uint128(offers[id].pay_amt),
            uint128(offers[id].buy_amt),
            offers[id].timestamp
        );
    }

    function make(
        address    pay_gem,
        address    buy_gem,
        uint128  pay_amt,
        uint128  buy_amt
    )
        public
        returns (bytes32)
    {
        return bytes32(offer(pay_amt, pay_gem, buy_amt, buy_gem));
    }

    function take(bytes32 id, uint128 maxTakeAmount) public {
        require(buy(uint256(id), maxTakeAmount));
    }

    function kill(bytes32 id) public {
        require(cancel(uint256(id)));
    }

    // Make a new offer. Takes funds from the caller into market escrow.
    //
    // If matching is enabled:
    //     * creates new offer without putting it in
    //       the sorted list.
    //     * available to authorized contracts only!
    //     * keepers should call insert(id,pos)
    //       to put offer in the sorted list.
    //
    // If matching is disabled:
    //     * calls expiring market's offer().
    //     * available to everyone without authorization.
    //     * no sorting is done.
    //
    function offer(
        uint256 pay_amt,    //maker (ask) sell how much
        address pay_gem,   //maker (ask) sell which token
        uint256 buy_amt,    //taker (ask) buy how much
        address buy_gem    //taker (ask) buy which token
    )
        public
        can_offer
        returns (uint256)
    {
        return _offeru(pay_amt, pay_gem, buy_amt, buy_gem);
    }

    // Make a new offer. Takes funds from the caller into market escrow.
    function offer(
        uint256 pay_amt,    //maker (ask) sell how much
        address pay_gem,   //maker (ask) sell which token
        uint256 buy_amt,    //maker (ask) buy how much
        address buy_gem,   //maker (ask) buy which token
        uint256 pos         //position to insert offer, 0 should be used if unknown
    )
        public
        can_offer
        returns (uint256)
    {
        return offer(pay_amt, pay_gem, buy_amt, buy_gem, pos, true);
    }

    function offer(
        uint256 pay_amt,    //maker (ask) sell how much
        address pay_gem,   //maker (ask) sell which token
        uint256 buy_amt,    //maker (ask) buy how much
        address buy_gem,   //maker (ask) buy which token
        uint256 pos,        //position to insert offer, 0 should be used if unknown
        bool rounding    //match "close enough" orders?
    )
        public
        can_offer
        returns (uint256)
    {
        require(_dust[pay_gem] <= pay_amt);

        return _matcho(pay_amt, pay_gem, buy_amt, buy_gem, pos, rounding);
    }

    //Transfers funds from caller to offer maker, and from market to caller.
    function buy(uint256 id, uint256 amount)
        public
        can_buy(id)
        returns (bool)
    {
        return _buys(id, amount);
    }

    // Cancel an offer. Refunds offer maker.
    function cancel(uint256 id)
        public
        can_cancel(id)
        returns (bool success)
    {
        if (isOfferSorted(id)) {
            require(_unsort(id));
        } else {
            require(_hide(id));
        }
        // read-only offer. Modify an offer by directly accessing offers[id]
        OfferInfo memory _offer = offers[id];
        delete offers[id];

        IErc20(_offer.pay_gem).transfer(_offer.owner, _offer.pay_amt);

        emit LogItemUpdate(id);
        emit LogKill(
            bytes32(id),
            keccak256(abi.encodePacked(_offer.pay_gem, _offer.buy_gem)),
            _offer.owner,
            _offer.pay_gem,
            _offer.buy_gem,
            uint128(_offer.pay_amt),
            uint128(_offer.buy_amt),
            uint64(now)
        );

        success = true;
    }

    //insert offer into the sorted list
    //keepers need to use this function
    function insert(
        uint256 id,   //maker (ask) id
        uint256 pos   //position to insert into
    )
        public
        returns (bool)
    {
        require(!isOfferSorted(id));    //make sure offers[id] is not yet sorted
        require(isActive(id));          //make sure offers[id] is active

        _hide(id);                      //remove offer from unsorted offers list
        _sort(id, pos);                 //put offer into the sorted offers list
        emit LogInsert(msg.sender, id);
        return true;
    }

    //deletes _rank [id]
    //  Function should be called by keepers.
    function del_rank(uint256 id)
        public
        returns (bool)
    {
        require(!isActive(id) && _rank[id].delb != 0 && _rank[id].delb < block.number - 10);
        delete _rank[id];
        emit LogDelete(msg.sender, id);
        return true;
    }

    //set the minimum sell amount for a token
    //    Function is used to avoid "dust offers" that have
    //    very small amount of tokens to sell, and it would
    //    cost more gas to accept the offer, than the value
    //    of tokens received.
    function setMinSell(
        address pay_gem,     //token to assign minimum sell amount to
        uint256 dust          //maker (ask) minimum sell amount
    )
        public
        returns (bool)
    {
        _dust[pay_gem] = dust;
        emit LogMinSell(pay_gem, dust);
        return true;
    }

    //returns the minimum sell amount for an offer
    function getMinSell(
        address pay_gem      //token for which minimum sell amount is queried
    )
        public
        view
        returns (uint256)
    {
        return _dust[pay_gem];
    }

    //set buy functionality enabled/disabled
    function setBuyEnabled(bool buyEnabled_) public returns (bool) {
        buyEnabled = buyEnabled_;
        emit LogBuyEnabled(buyEnabled);
        return true;
    }

    //set matching enabled/disabled
    //    If matchingEnabled true(default), then inserted offers are matched.
    //    Except the ones inserted by contracts, because those end up
    //    in the unsorted list of offers, that must be later sorted by
    //    keepers using insert().
    //    If matchingEnabled is false then MatchingMarket is reverted to ExpiringMarket,
    //    and matching is not done, and sorted lists are disabled.
    function setMatchingEnabled(bool matchingEnabled_) public returns (bool) {
        matchingEnabled = matchingEnabled_;
        emit LogMatchingEnabled(matchingEnabled);
        return true;
    }

    //return the best offer for a token pair
    //      the best offer is the lowest one if it's an ask,
    //      and highest one if it's a bid offer
    function getBestOffer(address sell_gem, address buy_gem) public view returns(uint256) {
        return _best[sell_gem][buy_gem];
    }

    //return the next worse offer in the sorted list
    //      the worse offer is the higher one if its an ask,
    //      a lower one if its a bid offer,
    //      and in both cases the newer one if they're equal.
    function getWorseOffer(uint256 id) public view returns(uint256) {
        return _rank[id].prev;
    }

    //return the next better offer in the sorted list
    //      the better offer is in the lower priced one if its an ask,
    //      the next higher priced one if its a bid offer
    //      and in both cases the older one if they're equal.
    function getBetterOffer(uint256 id) public view returns(uint256) {

        return _rank[id].next;
    }

    //return the amount of better offers for a token pair
    function getOfferCount(address sell_gem, address buy_gem) public view returns(uint256) {
        return _span[sell_gem][buy_gem];
    }

    //get the first unsorted offer that was inserted by a contract
    //      Contracts can't calculate the insertion position of their offer because it is not an O(1) operation.
    //      Their offers get put in the unsorted list of offers.
    //      Keepers can calculate the insertion position offchain and pass it to the insert() function to insert
    //      the unsorted offer into the sorted list. Unsorted offers will not be matched, but can be bought with buy().
    function getFirstUnsortedOffer() public view returns(uint256) {
        return _head;
    }

    //get the next unsorted offer
    //      Can be used to cycle through all the unsorted offers.
    function getNextUnsortedOffer(uint256 id) public view returns(uint256) {
        return _near[id];
    }

    function isOfferSorted(uint256 id) public view returns(bool) {
        return _rank[id].next != 0
               || _rank[id].prev != 0
               || _best[offers[id].pay_gem][offers[id].buy_gem] == id;
    }

    function sellAllAmount(address pay_gem, uint256 pay_amt, address buy_gem, uint256 min_fill_amount)
        public
        returns (uint256 fill_amt)
    {
        uint256 offerId;
        while (pay_amt > 0) {                           //while there is amount to sell
            offerId = getBestOffer(buy_gem, pay_gem);   //Get the best offer for the token pair
            require(offerId != 0);                      //Fails if there are not more offers

            // There is a chance that pay_amt is smaller than 1 wei of the other token
            if (pay_amt * 1 ether < wdiv(offers[offerId].buy_amt, offers[offerId].pay_amt)) {
                break;                                  //We consider that all amount is sold
            }
            if (pay_amt >= offers[offerId].buy_amt) {                       //If amount to sell is higher or equal than current offer amount to buy
                fill_amt = SafeMath.add(fill_amt, offers[offerId].pay_amt);          //Add amount bought to acumulator
                pay_amt = SafeMath.sub(pay_amt, offers[offerId].buy_amt);            //Decrease amount to sell
                take(bytes32(offerId), uint128(offers[offerId].pay_amt));   //We take the whole offer
            } else { // if lower
                uint256 baux = rmul(pay_amt * 10 ** 9, rdiv(offers[offerId].pay_amt, offers[offerId].buy_amt)) / 10 ** 9;
                fill_amt = SafeMath.add(fill_amt, baux);         //Add amount bought to acumulator
                take(bytes32(offerId), uint128(baux));  //We take the portion of the offer that we need
                pay_amt = 0;                            //All amount is sold
            }
        }
        require(fill_amt >= min_fill_amount);
    }

    function buyAllAmount(address buy_gem, uint256 buy_amt, address pay_gem, uint256 max_fill_amount)
        public
        returns (uint256 fill_amt)
    {
        uint256 offerId;
        while (buy_amt > 0) {                           //Meanwhile there is amount to buy
            offerId = getBestOffer(buy_gem, pay_gem);   //Get the best offer for the token pair
            require(offerId != 0);

            // There is a chance that buy_amt is smaller than 1 wei of the other token
            if (buy_amt * 1 ether < wdiv(offers[offerId].pay_amt, offers[offerId].buy_amt)) {
                break;                                  //We consider that all amount is sold
            }
            if (buy_amt >= offers[offerId].pay_amt) {                       //If amount to buy is higher or equal than current offer amount to sell
                fill_amt = SafeMath.add(fill_amt, offers[offerId].buy_amt);          //Add amount sold to acumulator
                buy_amt = SafeMath.sub(buy_amt, offers[offerId].pay_amt);            //Decrease amount to buy
                take(bytes32(offerId), uint128(offers[offerId].pay_amt));   //We take the whole offer
            } else {                                                        //if lower
                fill_amt = SafeMath.add(fill_amt, rmul(buy_amt * 10 ** 9, rdiv(offers[offerId].buy_amt, offers[offerId].pay_amt)) / 10 ** 9); //Add amount sold to acumulator
                take(bytes32(offerId), uint128(buy_amt));                   //We take the portion of the offer that we need
                buy_amt = 0;                                                //All amount is bought
            }
        }
        require(fill_amt <= max_fill_amount);
    }

    function getBuyAmount(address buy_gem, address pay_gem, uint256 pay_amt) public view returns (uint256 fill_amt) {
        uint256 offerId = getBestOffer(buy_gem, pay_gem);           //Get best offer for the token pair
        while (pay_amt > offers[offerId].buy_amt) {
            fill_amt = SafeMath.add(fill_amt, offers[offerId].pay_amt);  //Add amount to buy accumulator
            pay_amt = SafeMath.sub(pay_amt, offers[offerId].buy_amt);    //Decrease amount to pay
            if (pay_amt > 0) {                                  //If we still need more offers
                offerId = getWorseOffer(offerId);               //We look for the next best offer
                require(offerId != 0);                          //Fails if there are not enough offers to complete
            }
        }
        fill_amt = SafeMath.add(fill_amt, rmul(pay_amt * 10 ** 9, rdiv(offers[offerId].pay_amt, offers[offerId].buy_amt)) / 10 ** 9); //Add proportional amount of last offer to buy accumulator
    }

    function getPayAmount(address pay_gem, address buy_gem, uint256 buy_amt) public view returns (uint256 fill_amt) {
        uint256 offerId = getBestOffer(buy_gem, pay_gem);           //Get best offer for the token pair
        while (buy_amt > offers[offerId].pay_amt) {
            fill_amt = SafeMath.add(fill_amt, offers[offerId].buy_amt);  //Add amount to pay accumulator
            buy_amt = SafeMath.sub(buy_amt, offers[offerId].pay_amt);    //Decrease amount to buy
            if (buy_amt > 0) {                                  //If we still need more offers
                offerId = getWorseOffer(offerId);               //We look for the next best offer
                require(offerId != 0);                          //Fails if there are not enough offers to complete
            }
        }
        fill_amt = SafeMath.add(fill_amt, rmul(buy_amt * 10 ** 9, rdiv(offers[offerId].buy_amt, offers[offerId].pay_amt)) / 10 ** 9); //Add proportional amount of last offer to pay accumulator
    }

    // ============ Internal Functions ============

    function _next_id()
        internal
        returns (uint256)
    {
        last_offer_id++; return last_offer_id;
    }

    function _buys(uint256 id, uint256 amount)
        internal
        returns (bool)
    {
        require(buyEnabled);
        if (amount == offers[id].pay_amt) {
            if (isOfferSorted(id)) {
                //offers[id] must be removed from sorted list because all of it is bought
                _unsort(id);
            }else{
                _hide(id);
            }
        }
        require(super_buy(id, amount));
        // If offer has become dust during buy, we cancel it
        if (isActive(id) && offers[id].pay_amt < _dust[offers[id].pay_gem]) {
            dustId = id; //enable current msg.sender to call cancel(id)
            cancel(id);
        }
        return true;
    }

    //find the id of the next higher offer after offers[id]
    function _find(uint256 id)
        internal
        view
        returns (uint256)
    {
        require(id > 0);

        address buy_gem = offers[id].buy_gem;
        address pay_gem = offers[id].pay_gem;
        uint256 top = _best[pay_gem][buy_gem];
        uint256 old_top = 0;

        // Find the larger-than-id order whose successor is less-than-id.
        while (top != 0 && _isPricedLtOrEq(id, top)) {
            old_top = top;
            top = _rank[top].prev;
        }
        return old_top;
    }

    //find the id of the next higher offer after offers[id]
    function _findpos(uint256 id, uint256 pos)
        internal
        view
        returns (uint256)
    {
        require(id > 0);

        // Look for an active order.
        while (pos != 0 && !isActive(pos)) {
            pos = _rank[pos].prev;
        }

        if (pos == 0) {
            //if we got to the end of list without a single active offer
            return _find(id);

        } else {
            // if we did find a nearby active offer
            // Walk the order book down from there...
            if(_isPricedLtOrEq(id, pos)) {
                uint256 old_pos;

                // Guaranteed to run at least once because of
                // the prior if statements.
                while (pos != 0 && _isPricedLtOrEq(id, pos)) {
                    old_pos = pos;
                    pos = _rank[pos].prev;
                }
                return old_pos;

            // ...or walk it up.
            } else {
                while (pos != 0 && !_isPricedLtOrEq(id, pos)) {
                    pos = _rank[pos].next;
                }
                return pos;
            }
        }
    }

    //return true if offers[low] priced less than or equal to offers[high]
    function _isPricedLtOrEq(
        uint256 low,   //lower priced offer's id
        uint256 high   //higher priced offer's id
    )
        internal
        view
        returns (bool)
    {
        return SafeMath.mul(offers[low].buy_amt, offers[high].pay_amt)
          >= SafeMath.mul(offers[high].buy_amt, offers[low].pay_amt);
    }

    //these variables are global only because of solidity local variable limit

    //match offers with taker offer, and execute token transactions
    function _matcho(
        uint256 t_pay_amt,    //taker sell how much
        address t_pay_gem,   //taker sell which token
        uint256 t_buy_amt,    //taker buy how much
        address t_buy_gem,   //taker buy which token
        uint256 pos,          //position id
        bool rounding      //match "close enough" orders?
    )
        internal
        returns (uint256 id)
    {
        uint256 best_maker_id;    //highest maker id
        uint256 t_buy_amt_old;    //taker buy how much saved
        uint256 m_buy_amt;        //maker offer wants to buy this much token
        uint256 m_pay_amt;        //maker offer wants to sell this much token

        // there is at least one offer stored for token pair
        while (_best[t_buy_gem][t_pay_gem] > 0) {
            best_maker_id = _best[t_buy_gem][t_pay_gem];
            m_buy_amt = offers[best_maker_id].buy_amt;
            m_pay_amt = offers[best_maker_id].pay_amt;

            // Ugly hack to work around rounding errors. Based on the idea that
            // the furthest the amounts can stray from their "true" values is 1.
            // Ergo the worst case has t_pay_amt and m_pay_amt at +1 away from
            // their "correct" values and m_buy_amt and t_buy_amt at -1.
            // Since (c - 1) * (d - 1) > (a + 1) * (b + 1) is equivalent to
            // c * d > a * b + a + b + c + d, we write...
            if (SafeMath.mul(m_buy_amt, t_buy_amt) > SafeMath.mul(t_pay_amt, m_pay_amt) +
                (rounding ? m_buy_amt + t_buy_amt + t_pay_amt + m_pay_amt : 0))
            {
                break;
            }
            // ^ The `rounding` parameter is a compromise borne of a couple days
            // of discussion.
            buy(best_maker_id, Math.min(m_pay_amt, t_buy_amt));
            t_buy_amt_old = t_buy_amt;
            t_buy_amt = SafeMath.sub(t_buy_amt, Math.min(m_pay_amt, t_buy_amt));
            t_pay_amt = SafeMath.mul(t_buy_amt, t_pay_amt) / t_buy_amt_old;

            if (t_pay_amt == 0 || t_buy_amt == 0) {
                break;
            }
        }

        if (t_buy_amt > 0 && t_pay_amt > 0 && t_pay_amt >= _dust[t_pay_gem]) {
            //new offer should be created
            id = super_offer(t_pay_amt, t_pay_gem, t_buy_amt, t_buy_gem);
            //insert offer into the sorted list
            _sort(id, pos);
        }
    }

    // Make a new offer without putting it in the sorted list.
    // Takes funds from the caller into market escrow.
    // ****Available to authorized contracts only!**********
    // Keepers should call insert(id,pos) to put offer in the sorted list.
    function _offeru(
        uint256 pay_amt,      //maker (ask) sell how much
        address pay_gem,     //maker (ask) sell which token
        uint256 buy_amt,      //maker (ask) buy how much
        address buy_gem      //maker (ask) buy which token
    )
        internal
        returns (uint256 id)
    {
        require(_dust[pay_gem] <= pay_amt);
        id = super_offer(pay_amt, pay_gem, buy_amt, buy_gem);
        _near[id] = _head;
        _head = id;
        emit LogUnsortedOffer(id);
    }

    //put offer into the sorted list
    function _sort(
        uint256 id,    //maker (ask) id
        uint256 pos    //position to insert into
    )
        internal
    {
        require(isActive(id));

        address buy_gem = offers[id].buy_gem;
        address pay_gem = offers[id].pay_gem;
        uint256 prev_id;                                      //maker (ask) id

        pos = pos == 0 || offers[pos].pay_gem != pay_gem || offers[pos].buy_gem != buy_gem || !isOfferSorted(pos)
        ?
            _find(id)
        :
            _findpos(id, pos);

        if (pos != 0) {                                    //offers[id] is not the highest offer
            //requirement below is satisfied by statements above
            //require(_isPricedLtOrEq(id, pos));
            prev_id = _rank[pos].prev;
            _rank[pos].prev = id;
            _rank[id].next = pos;
        } else {                                           //offers[id] is the highest offer
            prev_id = _best[pay_gem][buy_gem];
            _best[pay_gem][buy_gem] = id;
        }

        if (prev_id != 0) {                               //if lower offer does exist
            //requirement below is satisfied by statements above
            //require(!_isPricedLtOrEq(id, prev_id));
            _rank[prev_id].next = id;
            _rank[id].prev = prev_id;
        }

        _span[pay_gem][buy_gem]++;
        emit LogSortedOffer(id);
    }

    // Remove offer from the sorted list (does not cancel offer)
    function _unsort(
        uint256 id    //id of maker (ask) offer to remove from sorted list
    )
        internal
        returns (bool)
    {
        address buy_gem = offers[id].buy_gem;
        address pay_gem = offers[id].pay_gem;
        require(_span[pay_gem][buy_gem] > 0);

        require(_rank[id].delb == 0 &&                    //assert id is in the sorted list
                 isOfferSorted(id));

        if (id != _best[pay_gem][buy_gem]) {              // offers[id] is not the highest offer
            require(_rank[_rank[id].next].prev == id);
            _rank[_rank[id].next].prev = _rank[id].prev;
        } else {                                          //offers[id] is the highest offer
            _best[pay_gem][buy_gem] = _rank[id].prev;
        }

        if (_rank[id].prev != 0) {                        //offers[id] is not the lowest offer
            require(_rank[_rank[id].prev].next == id);
            _rank[_rank[id].prev].next = _rank[id].next;
        }

        _span[pay_gem][buy_gem]--;
        _rank[id].delb = block.number;                    //mark _rank[id] for deletion
        return true;
    }

    //Hide offer from the unsorted order book (does not cancel offer)
    function _hide(
        uint256 id     //id of maker offer to remove from unsorted list
    )
        internal
        returns (bool)
    {
        uint256 uid = _head;               //id of an offer in unsorted offers list
        uint256 pre = uid;                 //id of previous offer in unsorted offers list

        require(!isOfferSorted(id));    //make sure offer id is not in sorted offers list

        if (_head == id) {              //check if offer is first offer in unsorted offers list
            _head = _near[id];          //set head to new first unsorted offer
            _near[id] = 0;              //delete order from unsorted order list
            return true;
        }
        while (uid > 0 && uid != id) {  //find offer in unsorted order list
            pre = uid;
            uid = _near[uid];
        }
        if (uid != id) {                //did not find offer id in unsorted offers list
            return false;
        }
        _near[pre] = _near[id];         //set previous unsorted offer to point to offer after offer id
        _near[id] = 0;                  //delete order from unsorted order list
        return true;
    }

    // Accept given `quantity` of an offer. Transfers funds from caller to
    // offer maker, and from market to caller.
    function super_buy(uint256 id, uint256 quantity)
        internal
        returns (bool)
    {
        OfferInfo memory _offer = offers[id];
        uint256 spend = SafeMath.mul(quantity, _offer.buy_amt) / _offer.pay_amt;

        require(uint128(spend) == spend);
        require(uint128(quantity) == quantity);

        // For backwards semantic compatibility.
        if (quantity == 0 || spend == 0 ||
            quantity > _offer.pay_amt || spend > _offer.buy_amt)
        {
            return false;
        }

        offers[id].pay_amt = SafeMath.sub(_offer.pay_amt, quantity);
        offers[id].buy_amt = SafeMath.sub(_offer.buy_amt, spend);
        IErc20(_offer.buy_gem).transferFrom(msg.sender, _offer.owner, spend);
        IErc20(_offer.pay_gem).transfer(msg.sender, quantity);

        emit LogItemUpdate(id);
        emit LogTake(
            bytes32(id),
            keccak256(abi.encodePacked(_offer.pay_gem, _offer.buy_gem)),
            _offer.owner,
            _offer.pay_gem,
            _offer.buy_gem,
            msg.sender,
            uint128(quantity),
            uint128(spend),
            uint64(now)
        );
        emit LogTrade(quantity, _offer.pay_gem, spend, _offer.buy_gem);

        if (offers[id].pay_amt == 0) {
          delete offers[id];
        }

        return true;
    }

    // Make a new offer. Takes funds from the caller into market escrow.
    function super_offer(uint256 pay_amt, address pay_gem, uint256 buy_amt, address buy_gem)
        internal
        returns (uint256 id)
    {
        require(uint128(pay_amt) == pay_amt);
        require(uint128(buy_amt) == buy_amt);
        require(pay_amt > 0);
        require(pay_gem != address(0x0));
        require(buy_amt > 0);
        require(buy_gem != address(0x0));
        require(pay_gem != buy_gem);

        OfferInfo memory info;
        info.pay_amt = pay_amt;
        info.pay_gem = pay_gem;
        info.buy_amt = buy_amt;
        info.buy_gem = buy_gem;
        info.owner = msg.sender;
        info.timestamp = uint64(now);
        id = _next_id();
        offers[id] = info;

        IErc20(pay_gem).transferFrom(msg.sender, address(this), pay_amt);

        emit LogItemUpdate(id);
        emit LogMake(
            bytes32(id),
            keccak256(abi.encodePacked(pay_gem, buy_gem)),
            msg.sender,
            pay_gem,
            buy_gem,
            uint128(pay_amt),
            uint128(buy_amt),
            uint64(now)
        );
    }

    // ============ Math Functions ============

    function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = SafeMath.add(SafeMath.mul(x, y), RAY / 2) / RAY;
    }
    function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = SafeMath.add(SafeMath.mul(x, WAD), y / 2) / y;
    }
    function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = SafeMath.add(SafeMath.mul(x, RAY), y / 2) / y;
    }
}
