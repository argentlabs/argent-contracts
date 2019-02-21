pragma solidity ^0.5.4;
import "../utils/SafeMath.sol";
import "./ERC20.sol";
import "./KyberNetwork.sol";

contract TokenPriceProvider {

    using SafeMath for uint256;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // Address of Kyber's trading contract
    address constant internal KYBER_NETWORK_ADDRESS = 0x818E6FECD516Ecc3849DAf6845e3EC868087B755;

    mapping(address => uint256) public cachedPrices;

    function syncPrice(ERC20 token) public {
        uint256 expectedRate;
        (expectedRate,) = kyberNetwork().getExpectedRate(token, ERC20(ETH_TOKEN_ADDRESS), 10000);
        cachedPrices[address(token)] = expectedRate;
    }

    //
    // Convenience functions
    //

    function syncPriceForTokenList(ERC20[] memory tokens) public {
        for(uint16 i = 0; i < tokens.length; i++) {
            syncPrice(tokens[i]);
        }
    }

    /**
     * @dev Converts the value of _amount tokens in ether.
     * @param _amount the amount of tokens to convert (in 'token wei' twei)
     * @param _token the ERC20 token contract
     * @return the ether value (in wei) of _amount tokens with contract _token
     */
    function getEtherValue(uint256 _amount, address _token) public view returns (uint256) {
        uint256 decimals = ERC20(_token).decimals();
        uint256 price = cachedPrices[_token];
        return price.mul(_amount).div(10**decimals);
    }

    //
    // Internal
    //

    function kyberNetwork() internal view returns (KyberNetwork) {
        return KyberNetwork(KYBER_NETWORK_ADDRESS);
    }
}
