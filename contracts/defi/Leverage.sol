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

pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";

/**
 * @title Interface for a contract that can open Leveraged positions.
 * A user may wish to open a Leveraged Position to increase its exposure to a token (typically ETH).
 * It does so by providing an amount of ETH that will be locked as collateral and used to borrow another token
 * (typically DAI) based on a `_conversionRatio`. The borrowed tokens will be exchanged and added to the locked collateral.
 * This operation (borrowing tokens, converting and locking as additional collateral) is repeated `_iterations` times.
 * The wallet owner can increase its leverage by increasing the number of `_iterations` or by decreasing
 * the `_converstionRatio`.
 * @author Julien Niset - <julien@argent.xyz>, Olivier VDB - <olivier@argent.xyz>
 */
interface Leverage {

    event LeverageOpened(
        address indexed _wallet,
        bytes32 indexed _leverageId,
        address _collateral,
        uint256 _totalCollateral,
        uint256 _totalDebt);
    event LeverageClosed(address indexed _wallet, bytes32 indexed _leverageId, uint256 _debtPayment);


    /**
     * @dev Lets the owner of a wallet open a new Leveraged Position to increase their exposure to a collateral token.
     * @param _wallet The target wallet
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral token provided.
     * @param _conversionRatio The ratio of "additional collateral" to "additional debt" to use at each iteration
     * @param _iterations The number of times the operation "borrow tokens, convert and lock as additional collateral" should be repeated
     */
    function openLeveragedPosition(
        BaseWallet _wallet,
        address _collateral,
        uint256 _collateralAmount,
        uint256 _conversionRatio,
        uint8 _iterations
    )
        external
        returns (bytes32 _leverageId, uint256 _totalCollateral, uint256 _totalDebt);

    /**
     * @dev Lets the owner of a wallet close a previously opened Leveraged Position.
     * @param _wallet The target wallet
     * @param _leverageId The id of the CDP used to open the Leveraged Position.
     * @param _daiPayment The amount of DAI debt to repay before "unwinding" the position.
     */
    function closeLeveragedPosition(
        BaseWallet _wallet,
        bytes32 _leverageId,
        uint256 _daiPayment
    )
        external;

}