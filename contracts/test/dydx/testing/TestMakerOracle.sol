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

import { IMakerOracle } from "../external/interfaces/IMakerOracle.sol";


contract TestMakerOracle is
    IMakerOracle
{
    uint256 public price;
    bool public valid;

    function setValues(
        uint256 _price,
        bool _valid
    )
        external
    {
        price = _price;
        valid = _valid;
    }

    function peek()
        external
        view
        returns (bytes32, bool)
    {
        return (bytes32(price), valid);
    }

    function read()
        external
        view
        returns (bytes32)
    {
        require(valid);
        return bytes32(price);
    }
}
