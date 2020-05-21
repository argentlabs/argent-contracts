// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract TokenConsumer {

    function consume(address _erc20, address _from, address _to, uint256 _amount) external returns (bool) {
        return ERC20(_erc20).transferFrom(_from, _to, _amount);
    }
}