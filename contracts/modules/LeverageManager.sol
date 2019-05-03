pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "./common/ProviderModule.sol";
import "../storage/GuardianStorage.sol";
import "../defi/Invest.sol";

/**
 * @title LeverageManager
 * @dev Module to open a Leveraged Position and increase exposure to a token (typically ETH).
 * @author Julien Niset - <julien@argent.im>
 */
contract LeverageManager is BaseModule, RelayerModule, OnlyOwnerModule, ProviderModule {

    bytes32 constant NAME = "LeverageManager";

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
     * @dev Lets the owner of a wallet open a new Leveraged Position to increase their exposure to a collateral token. 
     * @param _wallet The target wallet
     * @param _provider The address of the provider to use.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral token provided.
     * @param _conversionRatio The ratio of "additional collateral" to "additional debt" to use at each iteration
     * @param _iterations The number of times the operation "borrow tokens, convert and lock as additional collateral" should be repeated
     */
    function openLeveragedPosition(
        BaseWallet _wallet,
        address _provider, 
        address _collateral, 
        uint256 _collateralAmount, 
        uint256 _conversionRatio,
        uint8 _iterations
    ) 
        external
        returns (bytes32 _leverageId)
    {
        require(isProvider(_provider), "LeverageManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "openLeveragedPosition(address,address,uint256,uint256,uint8,address[])", 
            address(_wallet), 
            _collateral,
            _collateralAmount,
            _conversionRatio,
            _iterations,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LeverageManager: request to provider failed");
    }

    /**
     * @dev Lets the owner of a wallet close a previously opened Leveraged Position. 
     * @param _wallet The target wallet
     * @param _leverageId The id of the CDP used to open the Leveraged Position.
     * @param _daiPayment The amount of DAI debt to repay before "unwinding" the position.
     * @param _oracles (optional) The address of one or more oracles contracts that may be used by the provider to query information on-chain.
     */
    function closeLeveragedPosition(
        BaseWallet _wallet,
        address _provider, 
        bytes32 _leverageId,
        uint256 _daiPayment
    ) 
        external
    {
        require(isProvider(_provider), "LeverageManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "closeLeveragedPosition(address,bytes32,uint256,address[])", 
            address(_wallet), 
            _leverageId,
            _daiPayment,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LeverageManager: request to provider failed");
    }
}