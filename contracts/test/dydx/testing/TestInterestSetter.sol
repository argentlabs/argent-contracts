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
import { IInterestSetter } from "../protocol/interfaces/IInterestSetter.sol";
import { Interest } from "../protocol/lib/Interest.sol";


/**
 * @title TestInterestSetter
 * @author dYdX
 *
 * Interest setter used for testing that always returns a constant interest rate
 */
contract TestInterestSetter is
    IInterestSetter
{
    mapping (address => Interest.Rate) public g_interestRates;

    function setInterestRate(
        address token,
        Interest.Rate memory rate
    )
        public
    {
        g_interestRates[token] = rate;
    }

    function getInterestRate(
        address token,
        uint256 /* borrowWei */,
        uint256 /* supplyWei */
    )
        public
        view
        returns (Interest.Rate memory)
    {
        return g_interestRates[token];
    }
}
