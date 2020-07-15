pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


contract ICToken is IERC20 {
    function redeem(uint redeemTokens) external returns (uint);

    function redeemUnderlying(uint redeemAmount) external returns (uint);
}


contract ICEther is ICToken {
    function mint() external payable;
}


contract ICERC20 is ICToken {
    function mint(uint mintAmount) external returns (uint);

    function underlying() external view returns (address token);
}
