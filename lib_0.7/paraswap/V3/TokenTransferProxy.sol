pragma solidity 0.7.5;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./IGST2.sol";


/**
* @dev Allows owner of the contract to transfer tokens on behalf of user.
* User will need to approve this contract to spend tokens on his/her behalf
* on Paraswap platform
*/
contract TokenTransferProxy is Ownable {
    using SafeERC20 for IERC20;

    IGST2 private _gst2;

    address private _gstHolder;

    constructor(address gst2, address gstHolder) public {
        _gst2 = IGST2(gst2);
        _gstHolder = gstHolder;
    }

    function getGSTHolder() external view returns(address) {
        return _gstHolder;
    }

    function getGST() external view returns(address) {
        return address(_gst2);
    }

    function changeGSTTokenHolder(address gstHolder) external onlyOwner {
        _gstHolder = gstHolder;

    }

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

    function freeGSTTokens(uint256 tokensToFree) external onlyOwner {
        _gst2.freeFromUpTo(_gstHolder, tokensToFree);
    }

}
