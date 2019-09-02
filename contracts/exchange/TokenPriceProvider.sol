pragma solidity ^0.5.4;
import "../utils/SafeMath.sol";
import "./ERC20.sol";
import "../base/Managed.sol";

contract TokenPriceProvider is Managed {

    using SafeMath for uint256;

    mapping(address => uint256) public cachedPrices;

    function setPrice(ERC20 _token, uint256 _price) external onlyManager {
        cachedPrices[address(_token)] = _price;
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
}
