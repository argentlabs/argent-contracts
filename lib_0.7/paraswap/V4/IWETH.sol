pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


abstract contract IWETH is IERC20 {
    function deposit() external virtual payable;
    function withdraw(uint256 amount) external virtual;
}
