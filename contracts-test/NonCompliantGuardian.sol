// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

/**
 * @title NonCompliantGuardian
 * @dev Test contract that consumes more than 5000 gas when its owner() method is called.
 * @author Julien Niset - <julien@argent.im>
 */
contract NonCompliantGuardian {

    function owner() public view returns (address) {
        for (uint i = 0; i < 20; i++) {
            ripemd160("garbage");
        }
        return msg.sender;
    }
}