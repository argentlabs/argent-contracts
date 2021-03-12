pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


contract IBETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
