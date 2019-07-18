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

    event InvestmentAdded(address indexed _wallet, address indexed _provider, address _token, uint256 _invested, uint256 _period);
    event InvestmentRemoved(address indexed _wallet, address indexed _provider, address _token, uint256 _fraction);

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
        ProviderModule(_registry, NAME)
        public
    {
        guardianStorage = _guardianStorage;

    }

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _token The token address.
     * @param _amount The amount of tokens to invest.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     */
    function addInvestment(
        BaseWallet _wallet, 
        address _provider, 
        address _token, 
        uint256 _amount, 
        uint256 _period
    ) 
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        bytes memory methodData = abi.encodeWithSignature(
            "addInvestment(address,address,uint256,uint256,address[])", 
            address(_wallet), 
            _token,
            _amount,
            _period,
            getProviderOracles(_wallet, _provider)
            );
        (bool success, bytes memory data) = delegateToProvider(_wallet, _provider, methodData);
        require(success, "InvestManager: request to provider failed");
        (uint256 invested) = abi.decode(data,(uint256));
        emit InvestmentAdded(address(_wallet), _provider, _token, invested, _period);
    }

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _token The token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000. 
     */
    function removeInvestment(
        BaseWallet _wallet, 
        address _provider, 
        address _token, 
        uint256 _fraction
    ) 
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet) 
    {
        bytes memory methodData = abi.encodeWithSignature(
            "removeInvestment(address,address,uint256,address[])", 
            address(_wallet), 
            _token,
            _fraction,
            getProviderOracles(_wallet, _provider)
            );
        (bool success, ) = delegateToProvider(_wallet, _provider, methodData);
        require(success, "InvestManager: request to provider failed");
        emit InvestmentRemoved(address(_wallet), _provider, _token, _fraction);
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
        require(isProvider(_wallet, _provider), "InvestManager: Not a valid provider");
        (_tokenValue, _periodEnd) = Invest(_provider).getInvestment(_wallet, _token, getProviderOracles(_wallet, _provider));
    }
}