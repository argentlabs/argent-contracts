pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./lib/SafeERC20.sol";


/**
* @dev Allows owner of the contract to transfer tokens on behalf of user.
* Contracts will need to approve this contract to spend tokens on their behalf
*/
contract KarmaTokenTransferProxy is Ownable {
    using SafeERC20 for IERC20;


    /**
    * @dev Allows owner of the contract to transfer tokens on user's behalf
    * @dev Swapper contract will be the owner of this contract
    * @param token Address of the token
    * @param from Address from which tokens will be transferred
    * @param to Receipent address of the tokens
    * @param amount Amount of tokens to transfer
    */
    function transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    )
        external
        onlyOwner
    {
        IERC20(token).safeTransferFrom(from, to, amount);
    }

}
