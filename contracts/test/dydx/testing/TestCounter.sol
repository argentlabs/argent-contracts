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
 * @title TestCounter
 * @author dYdX
 *
 * Counts function calls for testing
 */
contract TestCounter
{
    // ============ Storage ============

    uint256 public counterFallback;

    uint256 public counterOne;

    mapping (uint256 => uint256) public counterTwo;

    mapping (uint256 => mapping (uint256 => uint256)) public counterThree;

    // ============ Functions ============

    function()
        external
        payable
    {
        counterFallback++;
    }

    function functionOne()
        public
    {
        counterOne++;
    }

    function functionTwo(
        uint256 input
    )
        public
    {
        counterTwo[input]++;
    }

    function functionThree(
        uint256 input1,
        uint256 input2
    )
        public
    {
        counterThree[input1][input2]++;
    }
}
