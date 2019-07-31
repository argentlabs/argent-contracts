pragma solidity ^0.5.4;
import "../utils/SafeMath.sol";
import "./ERC20.sol";
import "./KyberNetwork.sol";
import "../base/Managed.sol";

contract TokenPriceProvider is Managed {

    using SafeMath for uint256;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // Address of Kyber's trading contract
    address constant internal KYBER_NETWORK_ADDRESS = 0x818E6FECD516Ecc3849DAf6845e3EC868087B755;

    mapping(address => uint256) public cachedPrices;

    function setPrice(ERC20 _token, uint256 _price) external onlyManager {
        cachedPrices[address(_token)] = _price;
    }

    function syncPrice(ERC20 _token) external onlyManager {
        _syncPrice(_token);
    }

    function syncPriceForTokenList(ERC20[] calldata _tokens) external onlyManager {
        for(uint16 i = 0; i < _tokens.length; i++) {
            _syncPrice(_tokens[i]);
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

    function _kyberNetwork() internal view returns (KyberNetwork) {
        return KyberNetwork(KYBER_NETWORK_ADDRESS);
    }

    function _syncPrice(ERC20 _token) internal {
        uint256 expectedRate;
        (expectedRate,) = _kyberNetwork().getExpectedRate(_token, ERC20(ETH_TOKEN_ADDRESS), 10000);
        cachedPrices[address(_token)] = expectedRate;
    }
}
