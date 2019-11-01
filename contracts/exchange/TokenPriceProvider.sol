pragma solidity ^0.5.4;
import "../utils/SafeMath.sol";
import "./ERC20.sol";
import "../base/Managed.sol";
import "./KyberNetwork.sol";

contract TokenPriceProvider is Managed {

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    mapping(address => uint256) public cachedPrices;

    // Address of the KyberNetwork contract
    KyberNetwork public kyberNetwork;

    constructor(KyberNetwork _kyberNetwork) public {
        kyberNetwork = _kyberNetwork;
    }

    function setPrice(ERC20 _token, uint256 _price) public onlyManager {
        cachedPrices[address(_token)] = _price;
    }

    function setPriceForTokenList(ERC20[] calldata _tokens, uint256[] calldata _prices) external onlyManager {
        for(uint16 i = 0; i < _tokens.length; i++) {
            setPrice(_tokens[i], _prices[i]);
        }
    }

    /**
     * @dev Converts the value of _amount tokens in ether.
     * @param _amount the amount of tokens to convert (in 'token wei' twei)
     * @param _token the ERC20 token contract
     * @return the ether value (in wei) of _amount tokens with contract _token
     */
    function getEtherValue(uint256 _amount, address _token) external view returns (uint256) {
        uint256 decimals = ERC20(_token).decimals();
        uint256 price = cachedPrices[_token];
        return price.mul(_amount).div(10**decimals);
    }

    //
    // The following is added to be backward-compatible with Argent's old backend
    //

    function setKyberNetwork(KyberNetwork _kyberNetwork) external onlyManager {
        kyberNetwork = _kyberNetwork;
    }

    function syncPrice(ERC20 _token) external {
        require(address(kyberNetwork) != address(0), "Kyber sync is disabled");
        (uint256 expectedRate,) = kyberNetwork.getExpectedRate(_token, ERC20(ETH_TOKEN_ADDRESS), 10000);
        cachedPrices[address(_token)] = expectedRate;
    }

    function syncPriceForTokenList(ERC20[] calldata _tokens) external {
        require(address(kyberNetwork) != address(0), "Kyber sync is disabled");
        for(uint16 i = 0; i < _tokens.length; i++) {
            (uint256 expectedRate,) = kyberNetwork.getExpectedRate(_tokens[i], ERC20(ETH_TOKEN_ADDRESS), 10000);
            cachedPrices[address(_tokens[i])] = expectedRate;
        }
    }
}