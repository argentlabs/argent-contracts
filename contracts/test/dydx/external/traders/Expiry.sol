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
import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { IAutoTrader } from "../../protocol/interfaces/IAutoTrader.sol";
import { ICallee } from "../../protocol/interfaces/ICallee.sol";
import { Account } from "../../protocol/lib/Account.sol";
import { Decimal } from "../../protocol/lib/Decimal.sol";
import { Math } from "../../protocol/lib/Math.sol";
import { Monetary } from "../../protocol/lib/Monetary.sol";
import { Require } from "../../protocol/lib/Require.sol";
import { Time } from "../../protocol/lib/Time.sol";
import { Types } from "../../protocol/lib/Types.sol";
import { OnlySolo } from "../helpers/OnlySolo.sol";


/**
 * @title Expiry
 * @author dYdX
 *
 * Sets the negative balance for an account to expire at a certain time. This allows any other
 * account to repay that negative balance after expiry using any positive balance in the same
 * account. The arbitrage incentive is the same as liquidation in the base protocol.
 */
contract Expiry is
    Ownable,
    OnlySolo,
    ICallee,
    IAutoTrader
{
    using SafeMath for uint32;
    using SafeMath for uint256;
    using Types for Types.Par;
    using Types for Types.Wei;

    // ============ Constants ============

    bytes32 constant FILE = "Expiry";

    // ============ Events ============

    event ExpirySet(
        address owner,
        uint256 number,
        uint256 marketId,
        uint32 time
    );

    event LogExpiryRampTimeSet(
        uint256 expiryRampTime
    );

    // ============ Storage ============

    // owner => number => market => time
    mapping (address => mapping (uint256 => mapping (uint256 => uint32))) g_expiries;

    // time over which the liquidation ratio goes from zero to maximum
    uint256 public g_expiryRampTime;

    // ============ Constructor ============

    constructor (
        address soloMargin,
        uint256 expiryRampTime
    )
        public
        OnlySolo(soloMargin)
    {
        g_expiryRampTime = expiryRampTime;
    }

    // ============ Owner Functions ============

    function ownerSetExpiryRampTime(
        uint256 newExpiryRampTime
    )
        external
        onlyOwner
    {
        emit LogExpiryRampTimeSet(newExpiryRampTime);
        g_expiryRampTime = newExpiryRampTime;
    }

    // ============ Getters ============

    function getExpiry(
        Account.Info memory account,
        uint256 marketId
    )
        public
        view
        returns (uint32)
    {
        return g_expiries[account.owner][account.number][marketId];
    }

    function getSpreadAdjustedPrices(
        uint256 heldMarketId,
        uint256 owedMarketId,
        uint32 expiry
    )
        public
        view
        returns (
            Monetary.Price memory,
            Monetary.Price memory
        )
    {
        Decimal.D256 memory spread = SOLO_MARGIN.getLiquidationSpreadForPair(
            heldMarketId,
            owedMarketId
        );

        uint256 expiryAge = Time.currentTime().sub(expiry);

        if (expiryAge < g_expiryRampTime) {
            spread.value = Math.getPartial(spread.value, expiryAge, g_expiryRampTime);
        }

        Monetary.Price memory heldPrice = SOLO_MARGIN.getMarketPrice(heldMarketId);
        Monetary.Price memory owedPrice = SOLO_MARGIN.getMarketPrice(owedMarketId);
        owedPrice.value = owedPrice.value.add(Decimal.mul(owedPrice.value, spread));

        return (heldPrice, owedPrice);
    }

    // ============ Only-Solo Functions ============

    function callFunction(
        address /* sender */,
        Account.Info memory account,
        bytes memory data
    )
        public
        onlySolo(msg.sender)
    {
        (
            uint256 marketId,
            uint32 expiryTime
        ) = parseCallArgs(data);

        // don't set expiry time for accounts with positive balance
        if (expiryTime != 0 && !SOLO_MARGIN.getAccountPar(account, marketId).isNegative()) {
            return;
        }

        setExpiry(account, marketId, expiryTime);
    }

    function getTradeCost(
        uint256 inputMarketId,
        uint256 outputMarketId,
        Account.Info memory makerAccount,
        Account.Info memory /* takerAccount */,
        Types.Par memory oldInputPar,
        Types.Par memory newInputPar,
        Types.Wei memory inputWei,
        bytes memory data
    )
        public
        onlySolo(msg.sender)
        returns (Types.AssetAmount memory)
    {
        // return zero if input amount is zero
        if (inputWei.isZero()) {
            return Types.AssetAmount({
                sign: true,
                denomination: Types.AssetDenomination.Par,
                ref: Types.AssetReference.Delta,
                value: 0
            });
        }

        (
            uint256 owedMarketId,
            uint32 maxExpiry
        ) = parseTradeArgs(data);

        uint32 expiry = getExpiry(makerAccount, owedMarketId);

        // validate expiry
        Require.that(
            expiry != 0,
            FILE,
            "Expiry not set",
            makerAccount.owner,
            makerAccount.number,
            owedMarketId
        );
        Require.that(
            expiry <= Time.currentTime(),
            FILE,
            "Borrow not yet expired",
            expiry
        );
        Require.that(
            expiry <= maxExpiry,
            FILE,
            "Expiry past maxExpiry",
            expiry
        );

        return getTradeCostInternal(
            inputMarketId,
            outputMarketId,
            makerAccount,
            oldInputPar,
            newInputPar,
            inputWei,
            owedMarketId,
            expiry
        );
    }

    // ============ Private Functions ============

    function getTradeCostInternal(
        uint256 inputMarketId,
        uint256 outputMarketId,
        Account.Info memory makerAccount,
        Types.Par memory oldInputPar,
        Types.Par memory newInputPar,
        Types.Wei memory inputWei,
        uint256 owedMarketId,
        uint32 expiry
    )
        private
        returns (Types.AssetAmount memory)
    {
        Types.AssetAmount memory output;
        Types.Wei memory maxOutputWei = SOLO_MARGIN.getAccountWei(makerAccount, outputMarketId);

        if (inputWei.isPositive()) {
            Require.that(
                inputMarketId == owedMarketId,
                FILE,
                "inputMarket mismatch",
                inputMarketId
            );
            Require.that(
                !newInputPar.isPositive(),
                FILE,
                "Borrows cannot be overpaid",
                newInputPar.value
            );
            assert(oldInputPar.isNegative());
            Require.that(
                maxOutputWei.isPositive(),
                FILE,
                "Collateral must be positive",
                outputMarketId,
                maxOutputWei.value
            );
            output = owedWeiToHeldWei(
                inputWei,
                outputMarketId,
                inputMarketId,
                expiry
            );

            // clear expiry if borrow is fully repaid
            if (newInputPar.isZero()) {
                setExpiry(makerAccount, owedMarketId, 0);
            }
        } else {
            Require.that(
                outputMarketId == owedMarketId,
                FILE,
                "outputMarket mismatch",
                outputMarketId
            );
            Require.that(
                !newInputPar.isNegative(),
                FILE,
                "Collateral cannot be overused",
                newInputPar.value
            );
            assert(oldInputPar.isPositive());
            Require.that(
                maxOutputWei.isNegative(),
                FILE,
                "Borrows must be negative",
                outputMarketId,
                maxOutputWei.value
            );
            output = heldWeiToOwedWei(
                inputWei,
                inputMarketId,
                outputMarketId,
                expiry
            );

            // clear expiry if borrow is fully repaid
            if (output.value == maxOutputWei.value) {
                setExpiry(makerAccount, owedMarketId, 0);
            }
        }

        Require.that(
            output.value <= maxOutputWei.value,
            FILE,
            "outputMarket too small",
            output.value,
            maxOutputWei.value
        );
        assert(output.sign != maxOutputWei.sign);

        return output;
    }

    function setExpiry(
        Account.Info memory account,
        uint256 marketId,
        uint32 time
    )
        private
    {
        g_expiries[account.owner][account.number][marketId] = time;

        emit ExpirySet(
            account.owner,
            account.number,
            marketId,
            time
        );
    }

    function heldWeiToOwedWei(
        Types.Wei memory heldWei,
        uint256 heldMarketId,
        uint256 owedMarketId,
        uint32 expiry
    )
        private
        view
        returns (Types.AssetAmount memory)
    {
        (
            Monetary.Price memory heldPrice,
            Monetary.Price memory owedPrice
        ) = getSpreadAdjustedPrices(
            heldMarketId,
            owedMarketId,
            expiry
        );

        uint256 owedAmount = Math.getPartialRoundUp(
            heldWei.value,
            heldPrice.value,
            owedPrice.value
        );

        return Types.AssetAmount({
            sign: true,
            denomination: Types.AssetDenomination.Wei,
            ref: Types.AssetReference.Delta,
            value: owedAmount
        });
    }

    function owedWeiToHeldWei(
        Types.Wei memory owedWei,
        uint256 heldMarketId,
        uint256 owedMarketId,
        uint32 expiry
    )
        private
        view
        returns (Types.AssetAmount memory)
    {
        (
            Monetary.Price memory heldPrice,
            Monetary.Price memory owedPrice
        ) = getSpreadAdjustedPrices(
            heldMarketId,
            owedMarketId,
            expiry
        );

        uint256 heldAmount = Math.getPartial(
            owedWei.value,
            owedPrice.value,
            heldPrice.value
        );

        return Types.AssetAmount({
            sign: false,
            denomination: Types.AssetDenomination.Wei,
            ref: Types.AssetReference.Delta,
            value: heldAmount
        });
    }

    function parseCallArgs(
        bytes memory data
    )
        private
        pure
        returns (
            uint256,
            uint32
        )
    {
        Require.that(
            data.length == 64,
            FILE,
            "Call data invalid length",
            data.length
        );

        uint256 marketId;
        uint256 rawExpiry;

        /* solium-disable-next-line security/no-inline-assembly */
        assembly {
            marketId := mload(add(data, 32))
            rawExpiry := mload(add(data, 64))
        }

        return (
            marketId,
            Math.to32(rawExpiry)
        );
    }

    function parseTradeArgs(
        bytes memory data
    )
        private
        pure
        returns (
            uint256,
            uint32
        )
    {
        Require.that(
            data.length == 64,
            FILE,
            "Trade data invalid length",
            data.length
        );

        uint256 owedMarketId;
        uint256 rawExpiry;

        /* solium-disable-next-line security/no-inline-assembly */
        assembly {
            owedMarketId := mload(add(data, 32))
            rawExpiry := mload(add(data, 64))
        }

        return (
            owedMarketId,
            Math.to32(rawExpiry)
        );
    }
}
