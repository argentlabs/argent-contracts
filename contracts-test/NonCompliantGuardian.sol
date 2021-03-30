// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.3;

/**
 * @title NonCompliantGuardian
 * @notice Test contract that consumes more than 5000 gas when its owner() method is called.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract NonCompliantGuardian {

    function owner() public view returns (address) {
        for (uint i = 0; i < 20; i++) {
            ripemd160("garbage");
        }
        return msg.sender;
    }
}