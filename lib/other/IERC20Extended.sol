pragma solidity >=0.5.4 <0.7.0;

/**
 * Extended ERC20 contract interface to include the decimals property.
 */
interface IERC20Extended {
    function decimals() external view returns (uint);
    function totalSupply() external view returns (uint);
    function balanceOf(address tokenOwner) external view returns (uint balance);
    function allowance(address tokenOwner, address spender) external view returns (uint remaining);
    function transfer(address to, uint tokens) external returns (bool success);
    function approve(address spender, uint tokens) external returns (bool success);
    function transferFrom(address from, address to, uint tokens) external returns (bool success);
}