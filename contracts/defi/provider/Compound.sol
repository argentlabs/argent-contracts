pragma solidity ^0.5.4;
import "../../wallet/BaseWallet.sol";
import "../../exchange/ERC20.sol";
import "../../utils/SafeMath.sol";
import "../Iep.sol";

interface Comptroller {
    function enterMarkets(address[] calldata _cTokens) external returns (uint[] memory);
    function exitMarket(address _cToken) external returns (uint);
    function getAssetsIn(address _account) external view returns (address[] memory);
    function getAccountLiquidity(address _account) external view returns (uint, uint, uint);
}

interface CompoundRegistry {
    function getCToken(address _token) external view returns (address);
    function getComptroller() external view returns (address);
}

/**
 * @title Compound
 * @dev Wrapper contract to integrate Compound.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract Compound is Iep {

    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    /* ********************************** Implementation of Iep ************************************* */

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @param _oracle The address of an oracle contract that may be used by the method to query information on-chain (optional).
     */
    function addInvestment(BaseWallet _wallet, address[] calldata _tokens, uint256[] calldata _amounts, uint256 _period, address _oracle) external {
        for(uint i = 0; i < _tokens.length; i++) {
            address cToken = CompoundRegistry(_oracle).getCToken(_tokens[i]);
            require(cToken != address(0), "Compound: No market for target token");
            addLiquidityToCToken(_wallet, cToken, _tokens[i], _amounts[i], _oracle);
        }
    }

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _fractions The fraction of invested tokens to exit in per 10000. 
     * @param _oracle The address of an oracle contract that may be used by the method to query information on-chain (optional).
     */
    function removeInvestment(BaseWallet _wallet, address[] calldata _tokens, uint256 _fraction, address _oracle) external {
        for(uint i = 0; i < _tokens.length; i++) {
            address cToken = CompoundRegistry(_oracle).getCToken(_tokens[i]);
            require(cToken != address(0), "Compound: No market for target token");
            uint shares = ERC20(cToken).balanceOf(address(_wallet));
            removeLiquidityFromCToken(_wallet, cToken, _tokens[i], shares.mul(_fraction).div(10000));
        }
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _oracle The address of an oracle contract that may be used by the method to query information on-chain (optional).
     * @return A representation of the amount of tokens invested and the time at which the eip can be closed.
     */
    function getInvestment(BaseWallet _wallet, address _token, address _oracle) external view returns (uint256 _shares, uint256 _periodEnd) {
        address cToken = CompoundRegistry(_oracle).getCToken(_token);
        _shares = ERC20(cToken).balanceOf(address(_wallet));
        _periodEnd = now - 1;
    }

    /* ****************************************** Utility methods ******************************************* */

    function addLiquidityToCToken(BaseWallet _wallet, address _cToken, address _token, uint256 _amount, address _registry) internal {
        require(_amount > 0, "Compound: amount cannot be 0");
        uint balance = ERC20(_cToken).balanceOf(address(_wallet));
        if ( balance == 0) {
            address comptroller = CompoundRegistry(_registry).getComptroller();
            _wallet.invoke(comptroller, 0, abi.encodeWithSignature("enterMarkets(address[])", [_cToken]));
        }
        
        if(_token == ETH_TOKEN_ADDRESS) {
            _wallet.invoke(_cToken, _amount, abi.encodeWithSignature("mint()"));
        }
        else {
            _wallet.invoke(_token, 0, abi.encodeWithSignature("approve(address,uint256)", _cToken, _amount));
            _wallet.invoke(_cToken, 0, abi.encodeWithSignature("mint(uint256)", _amount));
        }
        assert(ERC20(_cToken).balanceOf(address(_wallet)) > balance);
    }

    function removeLiquidityFromCToken(BaseWallet _wallet, address _cToken, address _token, uint256 _amount) internal {        
        require(_amount > 0, "Compound: amount cannot be 0");
        uint balance = ERC20(_cToken).balanceOf(address(_wallet));
        _wallet.invoke(_cToken, 0, abi.encodeWithSignature("redeem(uint256)", _amount));
        assert(ERC20(_cToken).balanceOf(address(_wallet)) < balance);
    }




}