pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./Utils.sol";


contract TokenFetcher is Ownable {

    /**
    * @dev Allows owner of the contract to transfer tokens any tokens which are assigned to the contract
    * This method is for saftey if by any chance tokens or ETHs are assigned to the contract by mistake
    * @dev token Address of the token to be transferred
    * @dev destination Recepient of the token
    * @dev amount Amount of tokens to be transferred
    */
    function transferTokens(
        address token,
        address payable destination,
        uint256 amount
    )
        external
        onlyOwner
    {
        Utils.transferTokens(token, destination, amount);
    }
}