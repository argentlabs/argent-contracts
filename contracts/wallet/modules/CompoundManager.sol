// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;

import "../base/BaseModule.sol";
import "../base/Configuration.sol";
import "./ICompoundManager.sol";

/**
 * @title CompoundManager
 * @notice Module to invest and borrow tokens with CompoundV2
 * @author Julien Niset - <julien@argent.xyz>
 */
contract CompoundManager is ICompoundManager, BaseModule {

    using SafeMath for uint256;
    /* ********************************** Implementation of Loan ************************************* */

    /**
    * @inheritdoc ICompoundManager
    */
    function openLoan(
        address _collateral,
        uint256 _collateralAmount,
        address _debtToken,
        uint256 _debtAmount
    )
        external override
        onlyWalletOwner()
        onlyWhenUnlocked()
        returns (bytes32 _loanId)
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();

        address[] memory markets = new address[](2);
        markets[0] = compoundRegistry.getCToken(_collateral);
        markets[1] = compoundRegistry.getCToken(_debtToken);

        IComptroller comptroller = Configuration(registry).comptroller();
        comptroller.enterMarkets(markets);

        mint(markets[0], _collateral, _collateralAmount);
        borrow(_debtToken, markets[1], _debtAmount);
        emit LoanOpened(address(this), _loanId, _collateral, _collateralAmount, _debtToken, _debtAmount);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function closeLoan(bytes32 _loanId) external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        address _wallet = address(this);
        IComptroller comptroller = Configuration(registry).comptroller();

        address[] memory markets = comptroller.getAssetsIn(_wallet);
        for (uint i = 0; i < markets.length; i++) {
            address cToken = markets[i];
            uint debt = ICToken(cToken).borrowBalanceCurrent(_wallet);
            if (debt > 0) {
                repayBorrow(cToken, debt);
                uint collateral = ICToken(cToken).balanceOf(_wallet);
                if (collateral == 0) {
                    comptroller.exitMarket(address(cToken));
                }
            }
        }
        emit LoanClosed(_wallet, _loanId);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function addCollateral(bytes32 _loanId, address _collateral, uint256 _collateralAmount)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        address cToken = compoundRegistry.getCToken(_collateral);
        enterMarketIfNeeded(cToken, address(Configuration(registry).comptroller()));
        mint(cToken, _collateral, _collateralAmount);
        emit CollateralAdded(address(this), _loanId, _collateral, _collateralAmount);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function removeCollateral(bytes32 _loanId, address _collateral, uint256 _collateralAmount)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        address cToken = compoundRegistry.getCToken(_collateral);
        redeemUnderlying(cToken, _collateralAmount);
        exitMarketIfNeeded(cToken, address(Configuration(registry).comptroller()));
        emit CollateralRemoved(address(this), _loanId, _collateral, _collateralAmount);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function addDebt(bytes32 _loanId, address _debtToken, uint256 _debtAmount)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        address dToken = compoundRegistry.getCToken(_debtToken);
        enterMarketIfNeeded(dToken, address(Configuration(registry).comptroller()));
        borrow(_debtToken, dToken, _debtAmount);
        emit DebtAdded(address(this), _loanId, _debtToken, _debtAmount);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function removeDebt(bytes32 _loanId, address _debtToken, uint256 _debtAmount)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        address dToken = compoundRegistry.getCToken(_debtToken);
        repayBorrow(dToken, _debtAmount);
        exitMarketIfNeeded(dToken, address(Configuration(registry).comptroller()));
        emit DebtRemoved(address(this), _loanId, _debtToken, _debtAmount);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function getLoan(bytes32 /* _loanId */)
    external override view
    returns (uint8 _status, uint256 _ethValue)
    {
        IComptroller comptroller = Configuration(registry).comptroller();
        (uint error, uint liquidity, uint shortfall) = comptroller.getAccountLiquidity(address(this));
        require(error == 0, "CM: failed to get account liquidity");
        if (liquidity > 0) {
            return (1, liquidity);
        }
        if (shortfall > 0) {
            return (2, shortfall);
        }
        return (0,0);
    }

    /* ********************************** Implementation of Invest ************************************* */

    /**
    * @inheritdoc ICompoundManager
    */
    function addInvestment(address _token, uint256 _amount, uint256 _period)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    returns (uint256 _invested)
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        address cToken = compoundRegistry.getCToken(_token);
        mint(cToken, _token, _amount);
        _invested = _amount;
        emit InvestmentAdded(address(this), _token, _amount, _period);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function removeInvestment(address _token, uint256 _fraction)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        address _wallet = address(this);
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        require(_fraction <= 10000, "CM: invalid fraction value");
        address cToken = compoundRegistry.getCToken(_token);
        uint shares = ICToken(cToken).balanceOf(_wallet);
        redeem(cToken, shares.mul(_fraction).div(10000));
        emit InvestmentRemoved(_wallet, _token, _fraction);
    }

    /**
    * @inheritdoc ICompoundManager
    */
    function getInvestment(address _token)
    external override view
    returns (uint256 _tokenValue, uint256 _periodEnd)
    {
        ICompoundRegistry compoundRegistry = Configuration(registry).compoundRegistry();
        address cToken = compoundRegistry.getCToken(_token);
        uint amount = ICToken(cToken).balanceOf(address(this));
        uint exchangeRateMantissa = ICToken(cToken).exchangeRateStored();
        _tokenValue = amount.mul(exchangeRateMantissa).div(10 ** 18);
        _periodEnd = 0;
    }

    /* ****************************************** Compound wrappers ******************************************* */

    /**
     * @notice Adds underlying tokens to a cToken contract.
     * @param _cToken The cToken contract.
     * @param _token The underlying token.
     * @param _amount The amount of underlying token to add.
     */
    function mint(address _cToken, address _token, uint256 _amount) internal {
        require(_cToken != address(0), "CM: No market for target token");
        require(_amount > 0, "CM: amount cannot be 0");
        uint256 initialCTokenAmount = ERC20(_cToken).balanceOf(address(this));
        if (_token == ETH_TOKEN) {
            ICToken(_cToken).mint{value:_amount}(_amount);
        } else {
            ERC20(_token).approve(_cToken, _amount);
            ICToken(_cToken).mint(_amount);
        }
        require(ERC20(_cToken).balanceOf(address(this)) > initialCTokenAmount, "CM: mint failed");
    }

    /**
     * @notice Redeems underlying tokens from a cToken contract.
     * @param _cToken The cToken contract.
     * @param _amount The amount of cToken to redeem.
     */
    function redeem(address _cToken, uint256 _amount) internal {
        // The following commented `require()` is not necessary as `ICToken(cToken).balanceOf(_wallet)` in `removeInvestment()`
        // would have reverted if `_cToken == address(0)`
        // It is however left as a comment as a reminder to include it if `removeInvestment()` is changed to use amounts instead of fractions.
        // require(_cToken != address(0), "CM: No market for target token");
        require(_amount > 0, "CM: amount cannot be 0");
        uint256 initialCTokenAmount = ERC20(_cToken).balanceOf(address(this));
        ICToken(_cToken).redeem(_amount);
        require(ERC20(_cToken).balanceOf(address(this)) < initialCTokenAmount, "CM: redeem failed");
    }

    /**
     * @notice Redeems underlying tokens from a cToken contract.
     * @param _cToken The cToken contract.
     * @param _amount The amount of underlying token to redeem.
     */
    function redeemUnderlying(address _cToken, uint256 _amount) internal {
        require(_cToken != address(0), "CM: No market for target token");
        require(_amount > 0, "CM: amount cannot be 0");
        uint256 initialCTokenAmount = ERC20(_cToken).balanceOf(address(this));
        ICToken(_cToken).redeemUnderlying(_amount);
        require(ERC20(_cToken).balanceOf(address(this)) < initialCTokenAmount, "CM: redeemUnderlying failed");
    }

    /**
     * @notice Borrows underlying tokens from a cToken contract.
     * @param _token The token contract.
     * @param _cToken The cToken contract.
     * @param _amount The amount of underlying tokens to borrow.
     */
    function borrow(address _token, address _cToken, uint256 _amount) internal {
        require(_cToken != address(0), "CM: No market for target token");
        require(_amount > 0, "CM: amount cannot be 0");
        uint256 initialTokenAmount = _token == ETH_TOKEN ? address(this).balance : ERC20(_token).balanceOf(address(this));
        ICToken(_cToken).borrow(_amount);
        uint256 finalTokenAmount = _token == ETH_TOKEN ? address(this).balance : ERC20(_token).balanceOf(address(this));
        require(finalTokenAmount > initialTokenAmount, "CM: borrow failed");
    }

    /**
     * @notice Repays some borrowed underlying tokens to a cToken contract.
     * @param _cToken The cToken contract.
     * @param _amount The amount of underlying to repay.
     */
    function repayBorrow(address _cToken, uint256 _amount) internal {
        address _wallet = address(this);
        require(_cToken != address(0), "CM: No market for target token");
        require(_amount > 0, "CM: amount cannot be 0");
        string memory symbol = ICToken(_cToken).symbol();
        uint256 initialTokenAmount;
        uint256 finalTokenAmount;
        if (keccak256(abi.encodePacked(symbol)) == keccak256(abi.encodePacked("cETH"))) {
            initialTokenAmount = _wallet.balance;
            ICToken(_cToken).repayBorrow{value:_amount}();
            finalTokenAmount = _wallet.balance;
        } else {
            address token = ICToken(_cToken).underlying();
            initialTokenAmount = ERC20(token).balanceOf(_wallet);
            
            ERC20(token).approve(_cToken, _amount);
            ICToken(_cToken).repayBorrow(_amount);
            finalTokenAmount = ERC20(token).balanceOf(_wallet);
        }
        require(finalTokenAmount < initialTokenAmount, "CM: repayBorrow failed");
    }

    /**
     * @notice Enters a cToken market if it was not entered before.
     * @param _cToken The cToken contract.
     * @param _comptroller The comptroller contract.
     */
    function enterMarketIfNeeded(address _cToken, address _comptroller) internal {
        bool isEntered = IComptroller(_comptroller).checkMembership(address(this), ICToken(_cToken));
        if (!isEntered) {
            address[] memory market = new address[](1);
            market[0] = _cToken;
            IComptroller(_comptroller).enterMarkets(market);
        }
    }

    /**
     * @notice Exits a cToken market if there is no more collateral and debt.
     * @param _cToken The cToken contract.
     * @param _comptroller The comptroller contract.
     */
    function exitMarketIfNeeded(address _cToken, address _comptroller) internal {
        uint collateral = ICToken(_cToken).balanceOf(address(this));
        uint debt = ICToken(_cToken).borrowBalanceStored(address(this));
        if (collateral == 0 && debt == 0) {
            IComptroller(_comptroller).exitMarket(_cToken);
        }
    }
}
