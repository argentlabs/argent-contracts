pragma solidity ^0.5.4;

/**
 * @title NonCompliantGuardian
 * @dev Test contract that consumes more then 5000 gas when its owner() methd is called.
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