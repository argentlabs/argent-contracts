pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract TokenConsumer {

    function consume(address _erc20, address _from, address _to, uint256 _amount) external returns (bool) {
        return ERC20(_erc20).transferFrom(_from, _to, _amount);
    }
}