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

import { IPriceOracle } from "../../protocol/interfaces/IPriceOracle.sol";
import { Monetary } from "../../protocol/lib/Monetary.sol";


/**
 * @title UsdcPriceOracle
 * @author dYdX
 *
 * PriceOracle that returns the price of USDC in USD
 */
contract UsdcPriceOracle is
    IPriceOracle
{
    // ============ Constants ============

    uint256 constant DECIMALS = 6;

    uint256 constant EXPECTED_PRICE = ONE_DOLLAR / (10 ** DECIMALS);

    // ============ IPriceOracle Functions =============

    function getPrice(
        address /* token */
    )
        public
        view
        returns (Monetary.Price memory)
    {
        return Monetary.Price({ value: EXPECTED_PRICE });
    }
}
