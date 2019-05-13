pragma solidity ^0.5.4;
import "./Exponential.sol";
import "./ErrorReporter.sol";
import "./CErc20.sol";
import "./CToken.sol";

interface PriceOracle {
    /**
     * @notice Indicator that this is a PriceOracle contract (for inspection)
     */
    function isPriceOracle() external pure returns (bool);

    /**
      * @notice Get the underlying price of a cToken asset
      * @param cToken The cToken to get the underlying price of
      * @return The underlying asset price mantissa (scaled by 1e18).
      *  Zero means the price is unavailable.
      */
    function getUnderlyingPrice(CToken cToken) external view returns (uint);
}

contract SimplePriceOracle is PriceOracle {
    mapping(address => uint) prices;
    bool public constant isPriceOracle = true;

    function getUnderlyingPrice(CToken cToken) public view returns (uint) {
        return prices[address(CErc20(address(cToken)).underlying())];
    }

    function setUnderlyingPrice(CToken cToken, uint underlyingPriceMantissa) public {
        prices[address(CErc20(address(cToken)).underlying())] = underlyingPriceMantissa;
    }

    // v1 price oracle interface for use as backing of proxy
    function assetPrices(address asset) external view returns (uint) {
        return prices[asset];
    }
}