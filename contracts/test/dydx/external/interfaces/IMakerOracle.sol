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
 * @title IMakerOracle
 * @author dYdX
 *
 * Interface for the price oracles run by MakerDao
 */
interface IMakerOracle {

    // Event that is logged when the `note` modifier is used
    event LogNote(
        bytes4 indexed msgSig,
        address indexed msgSender,
        bytes32 indexed arg1,
        bytes32 indexed arg2,
        uint256 msgValue,
        bytes msgData
    ) anonymous;

    // returns the current value (ETH/USD * 10**18) as a bytes32
    function peek()
        external
        view
        returns (bytes32, bool);

    // requires a fresh price and then returns the current value
    function read()
        external
        view
        returns (bytes32);
}
