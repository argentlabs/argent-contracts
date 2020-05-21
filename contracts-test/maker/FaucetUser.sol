// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "../../lib/maker/DS/DSToken.sol";

contract MakerFaucet {
    function gulp(address gem) external;
}

contract FaucetUser {
    constructor(MakerFaucet _faucet, IERC20 _gem) public {
        // `gulp` can only be called once by a given account. Hence,
        // this wrapper contract is a hack that lets us call `gulp` multiple times
        // for the same token recipient.
        _faucet.gulp(address(_gem));
        _gem.transfer(msg.sender, _gem.balanceOf(address(this)));
        selfdestruct(msg.sender);
    }
}