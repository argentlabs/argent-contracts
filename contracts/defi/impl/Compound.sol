pragma solidity ^0.5.4;
import "../../wallet/BaseWallet.sol";
import "../../exchange/ERC20.sol";
import "../../utils/SafeMath.sol";
import "../interfaces/SavingsAccount.sol";

interface Comptroller {
    function enterMarkets(address[] calldata cTokens) external returns (uint[] memory);
    function exitMarket(address cToken) external returns (uint);
    function getAssetsIn(address account) external view returns (address[] memory);
    function getAccountLiquidity(address account) external view returns (uint, uint, uint);
}

/**
 * @title SavingsAccount
 * @dev Interface for a contract that can invest tokens in order to earn an interest.
 * @author Julien Niset - <julien@argent.im>
 */
contract Compound is SavingsAccount {

    address constant internal COMPTROLLER = 0x3CA5a0E85aD80305c2d2c4982B2f2756f1e747a5; 
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment. Set to 0 if the period is not specified. 
     */
    function openSavingsAccount(BaseWallet _wallet, address[] calldata _tokens, uint256[] calldata _amounts, uint256 _period) external {
        for(uint i = 0; i < _tokens.length; i++) {
            addLiquidityToCToken(_wallet, _tokens[i], _amounts[i]);
        }
    }

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _fractions The fraction of invested tokens to exit in per 10000. 
     */
    function closeSavingsAccount(BaseWallet _wallet, address[] calldata _tokens, uint256 _fraction) external {
        for(uint i = 0; i < _tokens.length; i++) {
            // NOT WORKING?!
            address cToken = 0x3CA5a0E85aD80305c2d2c4982B2f2756f1e747a5;
            //////
            uint shares = ERC20(cToken).balanceOf(address(_wallet));
            removeLiquidityFromCToken(_wallet, _tokens[i], shares.mul(_fraction).div(10000));
        }
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _tokens The token address.
     * @return The amount of tokens invested.
     */
    function getSavingsAccount(BaseWallet _wallet, address _token) external view returns (uint256);

    function addLiquidityToCToken(BaseWallet _wallet, address _token, uint256 _amount) internal {

        address cToken = 0x3CA5a0E85aD80305c2d2c4982B2f2756f1e747a5;

        require(_amount > 0, "Compound: amount cannot be 0");
        uint balance = ERC20(cToken).balanceOf(address(_wallet));
        if ( balance == 0) {
            _wallet.invoke(COMPTROLLER, 0, abi.encodeWithSignature("enterMarkets(address[])", [cToken]));
        }
        if(_token == ETH_TOKEN_ADDRESS) {
            _wallet.invoke(cToken, _amount, abi.encodeWithSignature("mint()"));
        }
        else {
            _wallet.invoke(_token, 0, abi.encodeWithSignature("approve(address,uint256)", cToken, _amount));
            _wallet.invoke(cToken, 0, abi.encodeWithSignature("mint(uint256)", _amount));
        }
        assert(ERC20(cToken).balanceOf(address(_wallet)) > balance);
    }

    function removeLiquidityFromCToken(BaseWallet _wallet, address _token, uint256 _amount) internal {

        address cToken = 0x3CA5a0E85aD80305c2d2c4982B2f2756f1e747a5;
        
        require(_amount > 0, "Compound: amount cannot be 0");
        uint balance = ERC20(cToken).balanceOf(address(_wallet));
        _wallet.invoke(cToken, 0, abi.encodeWithSignature("redeem(uint256)", _amount));
        assert(ERC20(cToken).balanceOf(address(_wallet)) < balance);
    }




}