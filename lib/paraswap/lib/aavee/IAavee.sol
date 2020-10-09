pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

interface IAaveToken {
    function redeem(uint256 amount) external;
    function underlyingAssetAddress() external view returns(address);

}

interface IAaveLendingPool {
    function deposit(
        IERC20 token,
        uint256 amount,
        uint16 refCode
    )
        external
        payable;

}
