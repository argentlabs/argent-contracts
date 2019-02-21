pragma solidity ^0.5.4;

/**
 * @title Proxy
 * @dev Basic proxy that delegates all calls to a fixed implementing contract.
 * The implementing contract cannot be upgraded.
 * @author Julien Niset - <julien@argent.im>
 */
contract Proxy {

    address implementation;

    event Received(uint indexed value, address indexed sender, bytes data);

    constructor(address _implementation) public {
        implementation = _implementation;
    }

    function() external payable {

        if(msg.data.length == 0 && msg.value > 0) { 
            emit Received(msg.value, msg.sender, msg.data); 
        }
        else {
            // solium-disable-next-line security/no-inline-assembly
            assembly {
                let target := sload(0)
                calldatacopy(0, 0, calldatasize())
                let result := delegatecall(gas, target, 0, calldatasize(), 0, 0)
                returndatacopy(0, 0, returndatasize())
                switch result 
                case 0 {revert(0, returndatasize())} 
                default {return (0, returndatasize())}
            }
        }
    }
}