pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "./common/ProviderModule.sol";
import "../storage/GuardianStorage.sol";
import "../defi/Invest.sol";

/**
 * @title InvestManager
 * @dev Module to invest tokens with a provider in order to earn an interest. 
 * @author Julien Niset - <julien@argent.im>
 */
contract InvestManager is BaseModule, RelayerModule, OnlyOwnerModule, ProviderModule {

    bytes32 constant NAME = "InvestManager";

    // The Guardian storage 
    GuardianStorage public guardianStorage;

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "TT: wallet must be unlocked");
        _;
    }

    constructor(
        ModuleRegistry _registry, 
        GuardianStorage _guardianStorage
    ) 
        BaseModule(_registry, NAME) 
        public 
    {
        guardianStorage = _guardianStorage;

    }

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     */
    function addInvestment(
        BaseWallet _wallet, 
        address _provider, 
        address[] calldata _tokens, 
        uint256[] calldata _amounts, 
        uint256 _period
    ) 
        external
        onlyWhenUnlocked(_wallet) 
    {
        require(isProvider(_provider), "InvestManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "addInvestment(address,address[],uint256[],uint256,address[])", 
            address(_wallet), 
            _tokens,
            _amounts,
            _period,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "InvestManager: request to provider failed");
    }

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _tokens The array of token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000. 
     */
    function removeInvestment(
        BaseWallet _wallet, 
        address _provider, 
        address[] calldata _tokens, 
        uint256 _fraction
    ) 
        external 
        onlyWhenUnlocked(_wallet) 
    {
        require(isProvider(_provider), "InvestManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "removeInvestment(address,address[],uint256,address[])", 
            address(_wallet), 
            _tokens,
            _fraction,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "InvestManager: request to provider failed");
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _token The token address.
     * @return The value in tokens of the investment (including interests) and the time at which the investment can be removed.
     */
    function getInvestment(
        BaseWallet _wallet, 
        address _provider, 
        address _token
    ) 
        external 
        view 
        returns (uint256 _tokenValue, uint256 _periodEnd) 
    {
        require(isProvider(_provider), "InvestManager: Not a valid provider");
        (_tokenValue, _periodEnd) = Invest(_provider).getInvestment(_wallet, _token, providers[_provider].oracles);
    }
}