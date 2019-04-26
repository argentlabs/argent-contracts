pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";

/**
 * @title Interface for a contract that can invest tokens in order to earn an interest.
 * @author Julien Niset - <julien@argent.xyz>
 */
interface Invest {

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @param _oracle (optional) The address of an oracle contract that may be used by the provider to query information on-chain.
     */
    function addInvestment(
        BaseWallet _wallet, 
        address[] calldata _tokens, 
        uint256[] calldata _amounts, 
        uint256 _period, 
        address _oracle
    ) 
        external;

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.s
     * @param _tokens The array of token address.
     * @param _fractions The fraction of invested tokens to exit in per 10000. 
     * @param _oracle (optional) The address of an oracle contract that may be used by the provider to query information on-chain.
     */
    function removeInvestment(
        BaseWallet _wallet, 
        address[] calldata _tokens, 
        uint256 _fraction, 
        address _oracle
    ) 
        external;

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _oracle (optional) The address of an oracle contract that may be used by the provider to query information on-chain.
     * @return The value in tokens of the investment (including interests) and the time at which the investment can be removed.
     */
    function getInvestment(
        BaseWallet _wallet, 
        address _token, 
        address _oracle
    ) 
        external 
        view 
        returns (uint256 _tokenValue, uint256 _periodEnd);
}