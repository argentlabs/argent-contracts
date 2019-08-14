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
import { SoloMargin } from "../protocol/SoloMargin.sol";
import { Account } from "../protocol/lib/Account.sol";
import { Interest } from "../protocol/lib/Interest.sol";
import { Math } from "../protocol/lib/Math.sol";
import { Storage } from "../protocol/lib/Storage.sol";
import { Types } from "../protocol/lib/Types.sol";


contract TestSoloMargin is
    SoloMargin
{
    using Math for uint256;
    using SafeMath for uint256;

    // ============ Constructor ============

    constructor (
        Storage.RiskParams memory rp,
        Storage.RiskLimits memory rl
    )
        public
        SoloMargin(rp, rl)
    {}

    // ============ Testing Functions ============

    function setAccountBalance(
        Account.Info memory account,
        uint256 market,
        Types.Par memory newPar
    )
        public
    {
        Types.Par memory oldPar = g_state.accounts[account.owner][account.number].balances[market];
        Types.TotalPar memory totalPar = g_state.markets[market].totalPar;

        // roll-back oldPar
        if (oldPar.sign) {
            totalPar.supply = uint256(totalPar.supply).sub(oldPar.value).to128();
        } else {
            totalPar.borrow = uint256(totalPar.borrow).sub(oldPar.value).to128();
        }

        // roll-forward newPar
        if (newPar.sign) {
            totalPar.supply = uint256(totalPar.supply).add(newPar.value).to128();
        } else {
            totalPar.borrow = uint256(totalPar.borrow).add(newPar.value).to128();
        }

        g_state.markets[market].totalPar = totalPar;
        g_state.accounts[account.owner][account.number].balances[market] = newPar;
    }

    function setAccountStatus(
        Account.Info memory account,
        Account.Status status
    )
        public
    {
        g_state.accounts[account.owner][account.number].status = status;
    }

    function setMarketIndex(
        uint256 market,
        Interest.Index memory index
    )
        public
    {
        Interest.Index memory oldIndex = g_state.markets[market].index;

        if (index.borrow == 0) {
            index.borrow = oldIndex.borrow;
        }
        if (index.supply == 0) {
            index.supply = oldIndex.supply;
        }

        g_state.markets[market].index = index;
    }
}
