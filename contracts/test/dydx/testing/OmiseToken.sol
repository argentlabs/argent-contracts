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


contract OmiseToken {
    using SafeMath for uint256;

    uint256 supply;
    mapping (address => uint256) balances;
    mapping (address => mapping (address => uint256)) allowed;

    event Transfer(address token, address from, address to, uint256 value);
    event Approval(address token, address owner, address spender, uint256 value);
    event Issue(address token, address owner, uint256 value);

    // Allow anyone to get new token
    function issue(uint256 amount) public {
        issueTo(msg.sender, amount);
    }

    function issueTo(address who, uint256 amount) public {
        supply = supply.add(amount);
        balances[who] = balances[who].add(amount);
        emit Issue(address(this), who, amount);
    }

    function totalSupply() public view returns (uint256) {
        return supply;
    }

    function balanceOf(address who) public view returns (uint256) {
        return balances[who];
    }

    function allowance(address owner, address spender) public view returns (uint256) {
        return allowed[owner][spender];
    }

    function symbol() public pure returns (string memory) {
        return "TOMG";
    }

    function name() public pure returns (string memory) {
        return "Test Omise";
    }

    function decimals() public pure returns (uint8) {
        return 18;
    }

    function transfer(address to, uint256 value) public {
        require(balances[msg.sender] >= value);

        balances[msg.sender] -= value;
        balances[to] = balances[to].add(value);
        emit Transfer(
            address(this),
            msg.sender,
            to,
            value
        );
    }

    function transferFrom(address from, address to, uint256 value) public {
        require(balances[from] >= value && allowed[from][msg.sender] >= value);

        balances[to] = balances[to].add(value);
        balances[from] = balances[from].sub(value);
        allowed[from][msg.sender] = allowed[from][msg.sender].sub(value);
        emit Transfer(
            address(this),
            from,
            to,
            value
        );
    }

    function approve(address spender, uint256 value) public {
        allowed[msg.sender][spender] = value;
        emit Approval(
            address(this),
            msg.sender,
            spender,
            value
        );
    }
}
