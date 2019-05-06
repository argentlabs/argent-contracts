pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "./common/ProviderModule.sol";
import "../storage/GuardianStorage.sol";
import "../defi/Loan.sol";

/**
 * @title LoanManager
 * @dev Module to invest tokens with a provider in order to earn an interest. 
 * @author Julien Niset - <julien@argent.im>
 */
contract LoanManager is BaseModule, RelayerModule, OnlyOwnerModule, ProviderModule {

    bytes32 constant NAME = "LoanManager";

    // The Guardian storage 
    GuardianStorage public guardianStorage;

    event LoanOpened(address indexed _wallet, address indexed _provider, bytes32 indexed _loanId, address _collateral, uint256 _collateralAmount, address _debtToken, uint256 _debtAmount);
    event LoanClosed(address indexed _wallet, address indexed _provider, bytes32 indexed _loanId);
    event CollateralAdded(address indexed _wallet, address indexed _provider, bytes32 indexed _loanId, address _collateral, uint256 _collateralAmount);
    event CollateralRemoved(address indexed _wallet, address indexed _provider, bytes32 indexed _loanId, address _collateral, uint256 _collateralAmount);
    event DebtAdded(address indexed _wallet, address indexed _provider, bytes32 indexed _loanId, address _debtToken, uint256 _debtAmount);
    event DebtRemoved(address indexed _wallet, address indexed _provider, bytes32 indexed _loanId, address _debtToken, uint256 _debtAmount);

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "LoanManager: wallet must be unlocked");
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
     * @dev Opens a collateralized loan.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral provided.
     * @param _debtToken The token borrowed.
     * @param _debtAmount The amount of tokens borrowed.
     * @return (optional) An ID for the loan when the provider enables users to create multiple distinct loans.
     */
    function openLoan(
        BaseWallet _wallet, 
        address _provider, 
        address _collateral, 
        uint256 _collateralAmount, 
        address _debtToken, 
        uint256 _debtAmount
    )  
        external
        onlyWhenUnlocked(_wallet) 
        returns (bytes32 _loanId)
    {
        require(isProvider(_provider), "LoanManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "openLoan(address,address,uint256,address,uint256,address[])", 
            address(_wallet), 
            _collateral,
            _collateralAmount,
            _debtToken,
            _debtAmount,
            providers[_provider].oracles
            );
        (bool success, bytes memory data) = delegateToProvider(_provider, methodData);
        (_loanId) = abi.decode(data,(bytes32));
        require(success, "LoanManager: request to provider failed");
        emit LoanOpened(address(_wallet), _provider, _loanId, _collateral, _collateralAmount, _debtToken, _debtAmount);
    }

        /**
     * @dev Closes a collateralized loan by repaying all debts (plus interest) and redeeming all collateral (plus interest).
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _loanId The ID of the loan if any, 0 otherwise.
     */
    function closeLoan(
        BaseWallet _wallet, 
        address _provider, 
        bytes32 _loanId
    ) 
        external
        onlyWhenUnlocked(_wallet) 
    {
        require(isProvider(_provider), "LoanManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "closeLoan(address,bytes32,address[])", 
            address(_wallet), 
            _loanId,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LoanManager: request to provider failed");
        emit LoanClosed(address(_wallet), _provider, _loanId);
    }

    /**
     * @dev Adds collateral to a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _loanId The ID of the loan if any, 0 otherwise.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral to add.
     */
    function addCollateral(
        BaseWallet _wallet, 
        address _provider, 
        bytes32 _loanId, 
        address _collateral, 
        uint256 _collateralAmount
    ) 
        external
        onlyWhenUnlocked(_wallet) 
    {
        require(isProvider(_provider), "LoanManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "addCollateral(address,bytes32,address,uint256,address[])", 
            address(_wallet), 
            _loanId,
            _collateral,
            _collateralAmount,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LoanManager: request to provider failed");
        emit CollateralAdded(address(_wallet), _provider, _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Removes collateral from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _loanId The ID of the loan if any, 0 otherwise.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral to remove.
     */
    function removeCollateral(
        BaseWallet _wallet, 
        address _provider, 
        bytes32 _loanId, 
        address _collateral, 
        uint256 _collateralAmount
    ) 
        external
        onlyWhenUnlocked(_wallet) 
    {
        require(isProvider(_provider), "LoanManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "removeCollateral(address,bytes32,address,uint256,address[])", 
            address(_wallet), 
            _loanId,
            _collateral,
            _collateralAmount,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LoanManager: request to provider failed");
        emit CollateralRemoved(address(_wallet), _provider, _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Increases the debt by borrowing more token from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _loanId The ID of the loan if any, 0 otherwise.
     * @param _debtToken The token borrowed.
     * @param _debtAmount The amount of token to borrow.
     */
    function addDebt(
        BaseWallet _wallet, 
        address _provider, 
        bytes32 _loanId, 
        address _debtToken, 
        uint256 _debtAmount
    ) 
        external
        onlyWhenUnlocked(_wallet) 
    {
        require(isProvider(_provider), "LoanManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "addDebt(address,bytes32,address,uint256,address[])", 
            address(_wallet), 
            _loanId,
            _debtToken,
            _debtAmount,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LoanManager: request to provider failed");
        emit DebtAdded(address(_wallet), _provider, _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Decreases the debt by repaying some token from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _loanId The ID of the loan if any, 0 otherwise.
     * @param _debtToken The token to repay.
     * @param _debtAmount The amount of token to repay.
     */
    function removeDebt(
        BaseWallet _wallet, 
        address _provider, 
        bytes32 _loanId, 
        address _debtToken, 
        uint256 _debtAmount 
    ) 
        external
        onlyWhenUnlocked(_wallet)
    {
        require(isProvider(_provider), "LoanManager: Not a valid provider");
        bytes memory methodData = abi.encodeWithSignature(
            "removeDebt(address,bytes32,address,uint256,address[])", 
            address(_wallet), 
            _loanId,
            _debtToken,
            _debtAmount,
            providers[_provider].oracles
            );
        (bool success, ) = delegateToProvider(_provider, methodData);
        require(success, "LoanManager: request to provider failed");
        emit DebtRemoved(address(_wallet), _provider, _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Gets information about a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _provider The address of the provider to use.
     * @param _loanId The ID of the loan if any, 0 otherwise.
     * @return a status [0: no loan, 1: loan is safe, 2: loan is unsafe and can be liquidated, 3: unable to provide info] and the estimated ETH value of the loan
     * combining all collaterals and all debts. When status = 1 it represents the value that could still be borrowed, while with status = 2
     * it represents the value of collateral that should be added to avoid liquidation.      
     */
    function getLoan(
        BaseWallet _wallet, 
        address _provider, 
        bytes32 _loanId 
    ) 
        external 
        view 
        returns (uint8 _status, uint256 _ethValue)
    {
        (_status, _ethValue) = Loan(_provider).getLoan(_wallet, _loanId, providers[_provider].oracles);
    }   

}