pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

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

    function setStateAndPayToken(uint256 _state, address _erc20, uint256 _amount) public {
        ERC20(_erc20).transferFrom(msg.sender, address(this), _amount);
        state = _state;
        emit StateSet(_state, _amount);
    }
}