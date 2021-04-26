pragma solidity ^0.7.5;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title USDC ERC20 Token
 *
 * @dev Interface for the USDC token
 * https://etherscan.io/address/0xb7277a6e95992041568d9391d09d0122023778a2#code
 */
 abstract contract IUSDCToken is IERC20 {
    /**
     * @dev Function to add/update a new minter
     * @param minter The address of the minter
     * @param minterAllowedAmount The minting amount allowed for the minter
     * @return True if the operation was successful.
     */
    function configureMinter(address minter, uint256 minterAllowedAmount) external virtual returns (bool);

    /**
     * @dev Function to mint tokens
     * @param _to The address that will receive the minted tokens.
     * @param _amount The amount of tokens to mint. Must be less than or equal
     * to the minterAllowance of the caller.
     * @return A boolean that indicates if the operation was successful.
     */
    function mint(address _to, uint256 _amount) external virtual returns (bool);
}