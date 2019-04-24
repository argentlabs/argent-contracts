pragma solidity ^0.5.4;
import "../../wallet/BaseWallet.sol";

/**
 * @title Interface for an Interest Earning Position (IEP) contract that can invest tokens in order to earn an interest.
 * @author Julien Niset - <julien@argent.im>
 */
interface IEP {

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @param _helper The address of an helper contract that may be used by the method (optional).
     */
    function openIep(BaseWallet _wallet, address[] calldata _tokens, uint256[] calldata _amounts, uint256 _period, address _helper) external;

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.s
     * @param _tokens The array of token address.
     * @param _fractions The fraction of invested tokens to exit in per 10000. 
     * @param _helper The address of an helper contract that may be used by the method (optional).
     */
    function closeIep(BaseWallet _wallet, address[] calldata _tokens, uint256 _fraction, address _helper) external;

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _tokens The token address.
     * @return The amount of tokens invested.
     */
    function getIep(BaseWallet _wallet, address _token) external view returns (uint256 _shares, uint256 _periodEnd);
}