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
interface SoloMargin {
    function operate(Account.Info[] calldata accounts, Actions.ActionArgs[] calldata actions) external;

    // Getters
    function getMarketTokenAddress(uint256 marketId) external view returns (address);
    function getNumMarkets() external view returns (uint256);
    function getAccountWei(Account.Info calldata account, uint256 marketId) external view returns (Types.Wei memory);
}

/**
 * @title DydxManager
 * @dev Module to invest and borrow tokens with dydx
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract DydxManager is /*Loan,*/ Invest, BaseModule, RelayerModule, OnlyOwnerModule {

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
        Account.Info[] memory accounts = new Account.Info[](1);
        accounts[0].owner = address(_wallet);

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0].amount = Types.AssetAmount({
            sign: true,
            denomination: Types.AssetDenomination.Wei,
            ref: Types.AssetReference.Delta,
            value: _amount
        });
        actions[0].actionType = Actions.ActionType.Deposit;
        actions[0].primaryMarketId = marketIds[_token];
        actions[0].otherAddress = address(_wallet);

        _wallet.invoke(_token, 0, abi.encodeWithSignature("approve(address,uint256)", address(solo), _amount));

        _wallet.invoke(address(solo), 0, abi.encodeWithSignature(
            "operate((address,uint256)[],(uint8,uint256,(bool,uint8,uint8,uint256),uint256,uint256,address,uint256,bytes)[])",
            accounts, actions));

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

        Account.Info[] memory accounts = new Account.Info[](1);
        accounts[0].owner = address(_wallet);

        Actions.ActionArgs[] memory actions = new Actions.ActionArgs[](1);
        actions[0].amount = Types.AssetAmount({
            sign: false,
            denomination: Types.AssetDenomination.Wei,
            ref: Types.AssetReference.Delta,
            value: amount
        });
        actions[0].actionType = Actions.ActionType.Withdraw;
        actions[0].primaryMarketId = marketIds[_token];
        actions[0].otherAddress = address(_wallet);

        _wallet.invoke(address(solo), 0, abi.encodeWithSignature(
            "operate((address,uint256)[],(uint8,uint256,(bool,uint8,uint8,uint256),uint256,uint256,address,uint256,bytes)[])",
            accounts, actions));

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
}
