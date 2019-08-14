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
import { IAutoTrader } from "../protocol/interfaces/IAutoTrader.sol";
import { Account } from "../protocol/lib/Account.sol";
import { Require } from "../protocol/lib/Require.sol";


/**
 * @title TestCallee
 * @author dYdX
 *
 * ICallee for testing
 */
contract TestCallee is
    ICallee,
    OnlySolo
{
    // ============ Constants ============

    bytes32 constant FILE = "TestCallee";

    // ============ Events ============

    event Called(
        address indexed sender,
        address indexed accountOwner,
        uint256 accountNumber,
        uint256 accountData,
        uint256 senderData
    );

    // ============ Storage ============

    // owner => number => data
    mapping (address => mapping (uint256 => uint256)) public accountData;

    // sender => data
    mapping (address => uint256) public senderData;

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
        (
            uint256 aData,
            uint256 sData
        ) = parseData(data);

        emit Called(
            sender,
            account.owner,
            account.number,
            aData,
            sData
        );

        accountData[account.owner][account.number] = aData;
        senderData[sender] = sData;
    }

    // ============ Private Functions ============

    function parseData(
        bytes memory data
    )
        private
        pure
        returns (
            uint256,
            uint256
        )
    {
        Require.that(
            data.length == 64,
            FILE,
            "Call data invalid length"
        );

        uint256 aData;
        uint256 sData;

        /* solium-disable-next-line security/no-inline-assembly */
        assembly {
            aData := mload(add(data, 32))
            sData := mload(add(data, 64))
        }

        return (
            aData,
            sData
        );
    }
}
