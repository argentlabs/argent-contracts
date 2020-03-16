pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * ERC20 test contract.
 */
contract TestDAIPoints is ERC20Detailed, ERC20Mintable {
    IERC20 public dai;

    constructor (address _dai) public
        ERC20Detailed('Test DAIPoints', 'TestDAIp', 18) {
          dai = IERC20(_dai);
        }

    function getDAIPoints(uint256 _amount) public returns(bool) {
        getDAIPointsToAddress(_amount, msg.sender);
    }

    function getDAIPointsToAddress(uint256 _amount, address _recipient) public returns(bool) {
        require(dai.transferFrom(msg.sender, address(this), _amount), "DAI/transferFrom");
        _mint(_recipient, _amount);
        return true;
    }
}
