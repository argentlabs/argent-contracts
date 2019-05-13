pragma solidity ^0.5.4;
import "../../base/Owned.sol";

/**
 * @title CompoundRegistry
 * @dev Simple registry containing a mapping between underlying assets and their corresponding cToken.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract CompoundRegistry is Owned {

    mapping (address => address) internal cToken;

    event CTokenAdded(address indexed _underlying, address indexed _cToken);
    event CTokenRemoved(address indexed _underlying);

    /**
     * @dev Adds a new cToken to the registry.
     * @param _underlying The underlying asset.
     * @param _cToken The cToken.
     */
    function addCToken(address _underlying, address _cToken) external onlyOwner {
        require(cToken[_underlying] == address(0), "CR: cToken already added");
        cToken[_underlying] = _cToken;
        emit CTokenAdded(_underlying, _cToken);
    }

    /**
     * @dev Removes a cToken from the registry.
     * @param _underlying The underlying asset.
     */
    function removeCToken(address _underlying) external onlyOwner {
        require(cToken[_underlying] != address(0), "CR: cToken does not exists");
        delete cToken[_underlying];
        emit CTokenRemoved(_underlying);
    }

    /**
     * @dev Gets the cToken for a given underlying asset.
     * @param _underlying The underlying asset.
     */
    function getCToken(address _underlying) external view returns (address) {
        return cToken[_underlying];
    }
}