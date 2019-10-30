pragma solidity ^0.5.4;
import "../../base/Owned.sol";

/**
 * @title CompoundRegistry
 * @dev Simple registry containing a mapping between underlying assets and their corresponding cToken.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract CompoundRegistry is Owned {

    address[] tokens;

    mapping (address => CTokenInfo) internal cToken;

    struct CTokenInfo {
        bool exists;
        uint128 index;
        address market;
    }

    event CTokenAdded(address indexed _underlying, address indexed _cToken);
    event CTokenRemoved(address indexed _underlying);

    /**
     * @dev Adds a new cToken to the registry.
     * @param _underlying The underlying asset.
     * @param _cToken The cToken.
     */
    function addCToken(address _underlying, address _cToken) external onlyOwner {
        require(!cToken[_underlying].exists, "CR: cToken already added");
        cToken[_underlying].exists = true;
        cToken[_underlying].index = uint128(tokens.push(_underlying) - 1);
        cToken[_underlying].market = _cToken;
        emit CTokenAdded(_underlying, _cToken);
    }

    /**
     * @dev Removes a cToken from the registry.
     * @param _underlying The underlying asset.
     */
    function removeCToken(address _underlying) external onlyOwner {
        require(cToken[_underlying].exists, "CR: cToken does not exist");
        address last = tokens[tokens.length - 1];
        if(_underlying != last) {
            uint128 targetIndex = cToken[_underlying].index;
            tokens[targetIndex] = last;
            cToken[last].index = targetIndex;
        }
        tokens.length --;
        delete cToken[_underlying];
        emit CTokenRemoved(_underlying);
    }

    /**
     * @dev Gets the cToken for a given underlying asset.
     * @param _underlying The underlying asset.
     */
    function getCToken(address _underlying) external view returns (address) {
        return cToken[_underlying].market;
    }

    /**
    * @dev Gets the list of supported underlyings.
    */
    function listUnderlyings() external view returns (address[] memory) {
        address[] memory underlyings = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            underlyings[i] = tokens[i];
        }
        return underlyings;
    }
}