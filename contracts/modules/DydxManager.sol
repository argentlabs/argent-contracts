pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "../utils/SafeMath.sol";
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";
import "../defi/Loan.sol";
import "../defi/Invest.sol";

library Account {
    struct Info {
        address owner;  // The address that owns the account
        uint256 number; // A nonce that allows a single address to control many accounts
    }
}
library Types {
    enum AssetDenomination {
        Wei, // the amount is denominated in wei
        Par  // the amount is denominated in par
    }
    enum AssetReference {
        Delta, // the amount is given as a delta from the current value
        Target // the amount is given as an exact number to end up at
    }
    struct AssetAmount {
        bool sign; // true if positive
        AssetDenomination denomination;
        AssetReference ref;
        uint256 value;
    }
    struct Wei {
        bool sign; // true if positive
        uint256 value;
    }
    struct Par {
        bool sign; // true if positive
        uint128 value;
    }
}
library Actions {
    enum ActionType {
        Deposit,   // supply tokens
        Withdraw,  // borrow tokens
        Transfer,  // transfer balance between accounts
        Buy,       // buy an amount of some token (externally)
        Sell,      // sell an amount of some token (externally)
        Trade,     // trade tokens against another account
        Liquidate, // liquidate an undercollateralized or expiring account
        Vaporize,  // use excess tokens to zero-out a completely negative account
        Call       // send arbitrary data to an address
    }
    struct ActionArgs {
        ActionType actionType;
        uint256 accountId;
        Types.AssetAmount amount;
        uint256 primaryMarketId;
        uint256 secondaryMarketId;
        address otherAddress;
        uint256 otherAccountId;
        bytes data;
    }
}
library Monetary {
    struct Value {
        uint256 value;
    }
}
library Decimal {
    struct D256 {
        uint256 value;
    }
}

interface SoloMargin {
    function operate(Account.Info[] calldata accounts, Actions.ActionArgs[] calldata actions) external;

    // Getters
    function getMarketTokenAddress(uint256 marketId) external view returns (address);
    function getNumMarkets() external view returns (uint256);
    function getAccountWei(Account.Info calldata account, uint256 marketId) external view returns (Types.Wei memory);
    function getAdjustedAccountValues(Account.Info calldata account) external view returns (Monetary.Value memory, Monetary.Value memory);
    function getMarginRatio() external view returns (Decimal.D256 memory);
    function getAccountBalances(Account.Info calldata account) external view returns (address[] memory, Types.Par[] memory, Types.Wei[] memory);
}

/**
 * @title DydxManager
 * @dev Module to invest and borrow tokens with dydx
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract DydxManager is Loan, Invest, BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "Dydx";

    // The Guardian storage contract
    GuardianStorage public guardianStorage;
    // The solo contract, dydx's main point of entry
    SoloMargin public solo;
    // mapping of token addresses to dydx market ids
    mapping(address => uint256) public marketIds;

    using SafeMath for uint256;

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "Dydx: wallet must be unlocked");
        _;
    }

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        SoloMargin _solo
    )
        BaseModule(_registry, NAME)
        public
    {
        guardianStorage = _guardianStorage;
        solo = _solo;
        uint256 numMarkets = solo.getNumMarkets();
        for(uint256 i = 0; i < numMarkets; i++) {
            marketIds[solo.getMarketTokenAddress(i)] = i;
        }
    }

    /* ********************************** Implementation of Invest ************************************* */

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _amount The amount of tokens to invest.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @return The exact amount of tokens that have been invested.
     */
    function addInvestment(
        BaseWallet _wallet,
        address _token,
        uint256 _amount,
        uint256 _period
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns (uint256 _invested)
    {
        _moveFunds(_wallet, _token, _amount, /* isDeposit = */ true);
        _invested = _amount;
        emit InvestmentAdded(address(_wallet), _token, _amount, _period);
    }

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000.
     */
    function removeInvestment(
        BaseWallet _wallet,
        address _token,
        uint256 _fraction
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(_fraction <= 10000, "Dydx: invalid fraction value");

        Account.Info memory account;
        account.owner = address(_wallet);
        Types.Wei memory invested = solo.getAccountWei(account, marketIds[_token]);
        require(invested.sign, "Dydx: trying to withdraw a negative balance");
        uint256 amount = invested.value.mul(_fraction).div(10000);

        _moveFunds(_wallet, _token, amount, /* isDeposit = */ false);
        emit InvestmentRemoved(address(_wallet), _token, _fraction);
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @return The value in tokens of the investment (including interests) and the time at which the investment can be removed.
     */
    function getInvestment(
        BaseWallet _wallet,
        address _token
    )
        external
        view
        returns (uint256 _tokenValue, uint256 _periodEnd)
    {
        Account.Info memory account;
        account.owner = address(_wallet);
        Types.Wei memory invested = solo.getAccountWei(account, marketIds[_token]);
        if(invested.sign) _tokenValue = invested.value;
    }

    /* ********************************** Implementation of Loan ************************************* */

    /**
     * @dev Opens a collateralized loan.
     * @param _wallet The target wallet.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral token provided.
     * @param _debtToken The token borrowed.
     * @param _debtAmount The amount of tokens borrowed.
     * @return bytes32(0) as dydx does not allow the creation of multiple loans.
     */
    function openLoan(
        BaseWallet _wallet,
        address _collateral,
        uint256 _collateralAmount,
        address _debtToken,
        uint256 _debtAmount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns (bytes32 _loanId)
    {
        _moveFunds(_wallet, _collateral, _collateralAmount, /* isDeposit = */ true);
        _moveFunds(_wallet, _debtToken, _debtAmount, /* isDeposit = */ false);

        emit LoanOpened(address(_wallet), _loanId, _collateral, _collateralAmount, _debtToken, _debtAmount);
    }

    /**
     * @dev Closes the collateralized loan in all markets by repaying all debts (plus interest). Note that it does not redeem the collateral.
     * @param _wallet The target wallet.
     * @param _loanId bytes32(0) as dydx does not allow the creation of multiple loans.
     */
    function closeLoan(
        BaseWallet _wallet,
        bytes32 _loanId
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        Account.Info memory account = Account.Info(address(_wallet), 0);
        (address[] memory tokens,, Types.Wei[] memory balances) = solo.getAccountBalances(account);

        for(uint i = 0; i < tokens.length; i++) {
            if(!balances[i].sign) {
                _moveFunds(_wallet, tokens[i], balances[i].value, /* isDeposit = */ true);
            }
        }
        emit LoanClosed(address(_wallet), _loanId);
    }

    /**
     * @dev Adds collateral to a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId bytes32(0) as dydx does not allow the creation of multiple loans.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral to add.
     */
    function addCollateral(
        BaseWallet _wallet,
        bytes32 _loanId,
        address _collateral,
        uint256 _collateralAmount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        _moveFunds(_wallet, _collateral, _collateralAmount, /* isDeposit = */ true);
        emit CollateralAdded(address(_wallet), _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Removes collateral from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId bytes32(0) as dydx does not allow the creation of multiple loans.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral to remove.
     */
    function removeCollateral(
        BaseWallet _wallet,
        bytes32 _loanId,
        address _collateral,
        uint256 _collateralAmount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        _moveFunds(_wallet, _collateral, _collateralAmount, /* isDeposit = */ false);
        emit CollateralRemoved(address(_wallet), _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Increases the debt by borrowing more token from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId bytes32(0) as dydx does not allow the creation of multiple loans.
     * @param _debtToken The token borrowed.
     * @param _debtAmount The amount of token to borrow.
     */
    function addDebt(
        BaseWallet _wallet,
        bytes32 _loanId,
        address _debtToken,
        uint256 _debtAmount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        _moveFunds(_wallet, _debtToken, _debtAmount, /* isDeposit = */ false);
        emit DebtAdded(address(_wallet), _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Decreases the debt by repaying some token from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId bytes32(0) as dydx does not allow the creation of multiple loans.
     * @param _debtToken The token to repay.
     * @param _debtAmount The amount of token to repay.
     */
    function removeDebt(
        BaseWallet _wallet,
        bytes32 _loanId,
        address _debtToken,
        uint256 _debtAmount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        _moveFunds(_wallet, _debtToken, _debtAmount, /* isDeposit = */ true);
        emit DebtRemoved(address(_wallet), _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Gets information about a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId bytes32(0) as dydx does not allow the creation of multiple loans
     * @return a status [0: no loan, 1: loan is safe, 2: loan is unsafe and can be liquidated]
     * and a value (in ETH) representing the value that could still be borrowed when status = 1; or the value of the collateral
     * that should be added to avoid liquidation when status = 2.
     */
    function getLoan(
        BaseWallet _wallet,
        bytes32 _loanId
    )
        external
        view
        returns (uint8 _status, uint256 _ethValue)
    {
        Account.Info memory account = Account.Info(address(_wallet), 0);
        (Monetary.Value memory supplied, Monetary.Value memory borrowed) = solo.getAdjustedAccountValues(account);
        Decimal.D256 memory ratio = solo.getMarginRatio();

        if (borrowed.value == 0) {
            return (0, 0);
        }

        uint256 minSupplied = borrowed.value.add(borrowed.value.mul(ratio.value).div(10**18));
        if (minSupplied < supplied.value) {
            return (1, supplied.value - minSupplied);
        }
        return (2, minSupplied - supplied.value);
    }

    /* ****************************************** Dydx wrappers ******************************************* */

    /**
     * @dev Move funds between a wallet and a dydx account
     * @param _wallet The target wallet.
     * @param _token The token to transfer.
     * @param _amount The amount of token to transfer.
     * @param _isDeposit true for a deposit, false for a withdrawal.
     */
    function _moveFunds(BaseWallet _wallet, address _token, uint256 _amount, bool _isDeposit) internal {
        Account.Info[] memory accounts = new Account.Info[](1);
        accounts[0].owner = address(_wallet);

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0].amount = Types.AssetAmount({
            sign: _isDeposit,
            denomination: Types.AssetDenomination.Wei,
            ref: Types.AssetReference.Delta,
            value: _amount
        });
        actions[0].actionType = _isDeposit ? Actions.ActionType.Deposit : Actions.ActionType.Withdraw;
        actions[0].primaryMarketId = marketIds[_token];
        actions[0].otherAddress = address(_wallet);

        if(_isDeposit) {
             _wallet.invoke(_token, 0, abi.encodeWithSignature("approve(address,uint256)", address(solo), _amount));
        }

        _wallet.invoke(address(solo), 0, abi.encodeWithSignature(
            "operate((address,uint256)[],(uint8,uint256,(bool,uint8,uint8,uint256),uint256,uint256,address,uint256,bytes)[])",
            accounts, actions));
    }
}
