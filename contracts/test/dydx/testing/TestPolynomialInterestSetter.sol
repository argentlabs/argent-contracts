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

import { PolynomialInterestSetter } from "../external/interestsetters/PolynomialInterestSetter.sol";


/**
 * @title TestPolynomialInterestSetter
 * @author dYdX
 *
 * PolynomialInterestSetter for testing
 */
contract TestPolynomialInterestSetter is
    PolynomialInterestSetter
{
    constructor(
        PolyStorage memory parameters
    )
        public
        PolynomialInterestSetter(parameters)
    {
    }

    function setParameters(
        PolyStorage memory parameters
    )
        public
    {
        g_storage = parameters;
    }

    function createNew(
        PolyStorage memory parameters
    )
        public
        returns (PolynomialInterestSetter)
    {
        return new PolynomialInterestSetter(parameters);
    }
}
