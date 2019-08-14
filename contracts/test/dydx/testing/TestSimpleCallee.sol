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

import { OnlySolo } from "../external/helpers/OnlySolo.sol";
import { ICallee } from "../protocol/interfaces/ICallee.sol";
import { Account } from "../protocol/lib/Account.sol";


/**
 * @title TestSimpleCallee
 * @author dYdX
 *
 * ICallee for testing any data being sent
 */
contract TestSimpleCallee is
    ICallee,
    OnlySolo
{
    // ============ Constants ============

    bytes32 constant FILE = "TestSimpleCallee";

    // ============ Events ============

    event Called(
        address indexed sender,
        address indexed accountOwner,
        uint256 accountNumber,
        bytes data
    );

    // ============ Constructor ============

    constructor(
        address soloMargin
    )
        public
        OnlySolo(soloMargin)
    {}

    // ============ ICallee Functions ============

    function callFunction(
        address sender,
        Account.Info memory account,
        bytes memory data
    )
        public
        onlySolo(msg.sender)
    {
        emit Called(
            sender,
            account.owner,
            account.number,
            data
        );
    }
}
