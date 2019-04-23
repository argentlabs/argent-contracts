pragma solidity ^0.5.4;
import "../../wallet/BaseWallet.sol";
import "../../exchange/ERC20.sol";
import "../../utils/SafeMath.sol";
import "../interfaces/SavingsAccount.sol";

/**
 * @title SavingsAccount
 * @dev Interface for a contract that can invest tokens in order to earn an interest.
 * @author Julien Niset - <julien@argent.im>
 */
contract Compound is SavingsAccount {

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment. Set to 0 if the period is not specified. 
     */
    function openSavingsAccount(BaseWallet _wallet, address[] calldata _tokens, uint256[] calldata _amounts, uint256 _period) external;

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _fractions The fraction of invested tokens to exit in per 10000. 
     */
    function closeSavingsAccount(BaseWallet _wallet, address[] calldata _tokens, uint256[] calldata _fractions) external;

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _tokens The token address.
     * @return The amount of tokens invested.
     */
    function getSavingsAccount(BaseWallet _wallet, address _token) external view returns (uint256);
}