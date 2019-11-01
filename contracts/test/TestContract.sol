pragma solidity ^0.5.4;

/**
 * @title TestContract
 * @dev Represents an arbitrary contract. 
 * @author Olivier Vdb - <olivier@argent.im>
 */
contract TestContract {

   	uint256 public state;

    event StateSet(uint256 indexed _state, uint256 indexed _value);

    function setState(uint256 _state) public payable {
        state = _state;
        emit StateSet(_state, msg.value);
    }
}