// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

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

import "../../infrastructure/ICompoundRegistry.sol";
import "../../infrastructure/IComptroller.sol";

/**
 * @title ICompoundManager
 * @notice Interface functions for a wallet consolidated for clarity.
 * @author Elena Gesheva - <elena@argent.xyz>
 */
interface ICompoundManager {
    event InvestmentAdded(address indexed _wallet, address _token, uint256 _invested, uint256 _period);
    event InvestmentRemoved(address indexed _wallet, address _token, uint256 _fraction);
    event LoanOpened(
        address indexed _wallet,
        bytes32 indexed _loanId,
        address _collateral,
        uint256 _collateralAmount,
        address _debtToken,
        uint256 _debtAmount);
    event LoanClosed(address indexed _wallet, bytes32 indexed _loanId);
    event CollateralAdded(address indexed _wallet, bytes32 indexed _loanId, address _collateral, uint256 _collateralAmount);
    event CollateralRemoved(address indexed _wallet, bytes32 indexed _loanId, address _collateral, uint256 _collateralAmount);
    event DebtAdded(address indexed _wallet, bytes32 indexed _loanId, address _debtToken, uint256 _debtAmount);
    event DebtRemoved(address indexed _wallet, bytes32 indexed _loanId, address _debtToken, uint256 _debtAmount);

    /* ********************************** Loan Interface ************************************* */

    /**
     * @notice Opens a collateralized loan.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral token provided.
     * @param _debtToken The token borrowed.
     * @param _debtAmount The amount of tokens borrowed.
     * @return _loanId bytes32(0) as Compound does not allow the creation of multiple loans.
     */
    function openLoan(
        address _collateral,
        uint256 _collateralAmount,
        address _debtToken,
        uint256 _debtAmount
    ) external returns (bytes32 _loanId);

    /**
     * @notice Closes the collateralized loan in all markets by repaying all debts (plus interest). Note that it does not redeem the collateral.
     * @param _loanId bytes32(0) as Compound does not allow the creation of multiple loans.
     */
    function closeLoan(bytes32 _loanId) external;

    /**
     * @notice Adds collateral to a loan identified by its ID.
     * @param _loanId bytes32(0) as Compound does not allow the creation of multiple loans.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral to add.
     */
    function addCollateral(bytes32 _loanId, address _collateral, uint256 _collateralAmount) external;

    /**
     * @notice Removes collateral from a loan identified by its ID.
     * @param _loanId bytes32(0) as Compound does not allow the creation of multiple loans.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral to remove.
     */
    function removeCollateral(bytes32 _loanId, address _collateral, uint256 _collateralAmount) external;

    /**
     * @notice Increases the debt by borrowing more token from a loan identified by its ID.
     * @param _loanId bytes32(0) as Compound does not allow the creation of multiple loans.
     * @param _debtToken The token borrowed.
     * @param _debtAmount The amount of token to borrow.
     */
    function addDebt(bytes32 _loanId, address _debtToken, uint256 _debtAmount) external;

    /**
     * @notice Decreases the debt by repaying some token from a loan identified by its ID.
     * @param _loanId bytes32(0) as Compound does not allow the creation of multiple loans.
     * @param _debtToken The token to repay.
     * @param _debtAmount The amount of token to repay.
     */
    function removeDebt(bytes32 _loanId, address _debtToken, uint256 _debtAmount) external;

    /**
     * @notice Gets information about the loan status on Compound.
     * @return _status Status [0: no loan, 1: loan is safe, 2: loan is unsafe and can be liquidated]
     * @return _ethValue Value (in ETH) representing the value that could still be borrowed when status = 1; or the value of the collateral
     * that should be added to avoid liquidation when status = 2.
     */
    function getLoan(bytes32 /* _loanId */) external view returns (uint8 _status, uint256 _ethValue);

    /* ********************************** Invest Interface ************************************* */

    /**
     * @notice Invest tokens for a given period.
     * @param _token The token address.
     * @param _amount The amount of tokens to invest.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @return _invested The exact amount of tokens that have been invested.
     */
    function addInvestment(address _token, uint256 _amount, uint256 _period) external returns (uint256 _invested);

    /**
     * @notice Exit invested postions.
     * @param _token The token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000.
     */
    function removeInvestment(address _token, uint256 _fraction) external;

    /**
     * @notice Get the amount of investment in a given token.
     * @param _token The token address.
     * @return _tokenValue The value in tokens of the investment (including interests).
     * @return _periodEnd The time at which the investment can be removed.
     */
    function getInvestment(address _token) external view returns (uint256 _tokenValue, uint256 _periodEnd);
}