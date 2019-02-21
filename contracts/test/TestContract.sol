pragma solidity ^0.5.4;

/**
 * @title TestContract
 * @dev Represents an arbitrary contract. 
 * @author Olivier Vdb - <olivier@argent.im>
 */
contract TestContract {

   	uint256 public state;

    function setState(uint256 _state) public payable {
        state = _state;
    }
}