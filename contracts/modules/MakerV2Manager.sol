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

import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "./storage/GuardianStorage.sol";
import "../../lib/utils/SafeMath.sol";
import "../defi/Loan.sol";
import "../defi/Invest.sol";
import "../infrastructure/MakerRegistry.sol";

contract ManagerLike {
    function urns(uint) public view returns (address);
    function open(bytes32, address) public returns (uint);
    function frob(uint, int, int) public;
    function give(uint, address) public;
    function move(uint, address, uint) public;
}

contract ScdMcdMigration {
    function swapSaiToDai(uint wad) external;
    function swapDaiToSai(uint wad) external;
    JoinLike public saiJoin;
    JoinLike public wethJoin;
    JoinLike public daiJoin;
    ManagerLike public cdpManager;
}

contract PotLike {
    function chi() public view returns (uint);
    function pie(address) public view returns (uint);
    function drip() public;
}

/**
 * @title MakerV2Manager
 * @dev Module to convert SAI <-> DAI, lock/unlock MCD DAI into/from Maker's Pot,
 * migrate old CDPs and open and manage new CDPs.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract MakerV2Manager is Loan, Invest, BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "MakerV2Manager";

    // The address of the SAI token
    GemLike public saiToken;
    // The address of the (MCD) DAI token
    GemLike public daiToken;
    // The address of the WETH token
    GemLike public wethToken;
    // The address of the SAI <-> DAI migration contract
    address public scdMcdMigration;
    // The address of the Pot
    PotLike public pot;
    // The address of the Dai Adapter
    JoinLike public daiJoin;
    // The address of the Vat
    VatLike public vat;
    // The address of the CDP Manager
    ManagerLike public cdpManager;
    // The Maker Registry in which all supported collateral tokens and their adapters are stored
    MakerRegistry public makerRegistry;
    // Mapping loadId -> wallet
    mapping(bytes32 => BaseWallet) public cdpOwners;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // Method signatures to reduce gas cost at depoyment
    bytes4 constant internal ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 constant internal ERC20_TRANSFER = bytes4(keccak256("transfer(address,uint256)"));
    bytes4 constant internal WETH_DEPOSIT = bytes4(keccak256("deposit()"));
    bytes4 constant internal WETH_WITHDRAW = bytes4(keccak256("withdraw(uint256)"));
    bytes4 constant internal SWAP_SAI_DAI = bytes4(keccak256("swapSaiToDai(uint256)"));
    bytes4 constant internal SWAP_DAI_SAI = bytes4(keccak256("swapDaiToSai(uint256)"));
    bytes4 constant internal ADAPTER_JOIN = bytes4(keccak256("join(address,uint256)"));
    bytes4 constant internal ADAPTER_EXIT = bytes4(keccak256("exit(address,uint256)"));
    bytes4 constant internal VAT_HOPE = bytes4(keccak256("hope(address)"));
    bytes4 constant internal POT_JOIN = bytes4(keccak256("join(uint256)"));
    bytes4 constant internal POT_EXIT = bytes4(keccak256("exit(uint256)"));

    uint256 constant internal RAY = 10 ** 27;

    using SafeMath for uint256;

    // ****************** Events *************************** //

    event TokenConverted(address indexed _wallet, address _srcToken, uint _srcAmount, address _destToken, uint _destAmount);

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        ScdMcdMigration _scdMcdMigration,
        PotLike _pot,
        MakerRegistry _makerRegistry
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        scdMcdMigration = address(_scdMcdMigration);
        saiToken = _scdMcdMigration.saiJoin().gem();
        wethToken = _scdMcdMigration.wethJoin().gem();
        daiJoin = _scdMcdMigration.daiJoin();
        vat = daiJoin.vat();
        daiToken = daiJoin.dai();
        cdpManager = _scdMcdMigration.cdpManager();
        pot = _pot;
        makerRegistry = _makerRegistry;
        // Authorize daiJoin to exit DAI from the module's internal balance in the vat
        vat.hope(address(daiJoin));
    }

    // *************** External/Public Functions ********************* //

    /* ********************************** Implementation of Loan ************************************* */

   /**
     * @dev Opens a collateralized loan.
     * @param _wallet The target wallet.
     * @param _collateral The token used as a collateral.
     * @param _collateralAmount The amount of collateral token provided.
     * @param _debtToken The token borrowed (must be the address of the DAI contract).
     * @param _debtAmount The amount of tokens borrowed.
     * @return The ID of the created CDP.
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
        verifySupportedCollateral(_collateral);
        require(_debtToken == address(daiToken), "MV2: debt token must be DAI");
        _loanId = bytes32(openCdp(_wallet, _collateral, _collateralAmount, _debtAmount));
        cdpOwners[_loanId] = _wallet;
        emit LoanOpened(address(_wallet), _loanId, _collateral, _collateralAmount, _debtToken, _debtAmount);
    }

    /**
     * @dev Adds collateral to a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
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
        verifyAuthorizedLoanId(_loanId, _wallet);
        verifySupportedCollateral(_collateral);
        addCollateral(_wallet, uint256(_loanId), _collateral, _collateralAmount);
        emit CollateralAdded(address(_wallet), _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Removes collateral from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
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
        verifyAuthorizedLoanId(_loanId, _wallet);
        verifySupportedCollateral(_collateral);
        removeCollateral(_wallet, uint256(_loanId), _collateral, _collateralAmount);
        emit CollateralRemoved(address(_wallet), _loanId, _collateral, _collateralAmount);
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
        returns (uint256 _invested)
    {
        require(_token == address(daiToken), "DM: token should be DAI");
        joinDsr(_wallet, _amount);
        _invested = _amount;
        emit InvestmentAdded(address(_wallet), address(daiToken), _amount, _period);
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
    {
        require(_token == address(daiToken), "MV2: token should be DAI");
        require(_fraction <= 10000, "MV2: invalid fraction value");
        exitDsr(_wallet, dsrBalance(_wallet).mul(_fraction) / 10000);
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
        _tokenValue = _token == address(daiToken) ? dsrBalance(_wallet) : 0;
        _periodEnd = 0;
    }

    /* ****************************************** DSR wrappers ******************************************* */

    function dsrBalance(BaseWallet _wallet) public view returns (uint256) {
        return pot.chi().mul(pot.pie(address(_wallet))) / RAY;
    }

    /**
    * @dev lets the owner deposit MCD DAI into the DSR Pot.
    * @param _wallet The target wallet.
    * @param _amount The amount of DAI to deposit
    */
    function joinDsr(
        BaseWallet _wallet,
        uint256 _amount
    )
        public
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        if (daiToken.balanceOf(address(_wallet)) < _amount) {
            swapSaiToDai(_wallet, _amount - daiToken.balanceOf(address(_wallet)));
        }

        // Execute drip to get the chi rate updated to rho == now, otherwise join will fail
        pot.drip();
        // Approve DAI adapter to take the DAI amount
        invokeWallet(address(_wallet), address(daiToken), 0, abi.encodeWithSelector(ERC20_APPROVE, address(daiJoin), _amount));
        // Join DAI into the vat (_amount of external DAI is burned and the vat transfers _amount of internal DAI from the adapter to the _wallet)
        invokeWallet(address(_wallet), address(daiJoin), 0, abi.encodeWithSelector(ADAPTER_JOIN, address(_wallet), _amount));
        // Approve the pot to take out (internal) DAI from the wallet's balance in the vat
        if (vat.can(address(_wallet), address(pot)) == 0) {
            invokeWallet(address(_wallet), address(vat), 0, abi.encodeWithSelector(VAT_HOPE, address(pot)));
        }
        // Compute the pie value in the pot
        uint256 pie = _amount.mul(RAY) / pot.chi();
        // Join the pie value to the pot
        invokeWallet(address(_wallet), address(pot), 0, abi.encodeWithSelector(POT_JOIN, pie));
    }

    /**
    * @dev lets the owner withdraw MCD DAI from the DSR Pot.
    * @param _wallet The target wallet.
    * @param _amount The amount of DAI to withdraw
    */
    function exitDsr(
        BaseWallet _wallet,
        uint256 _amount
    )
        public
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        // Execute drip to count the savings accumulated until this moment
        pot.drip();
        // Calculates the pie value in the pot equivalent to the DAI wad amount
        uint256 pie = _amount.mul(RAY) / pot.chi();
        // Exit DAI from the pot
        invokeWallet(address(_wallet), address(pot), 0, abi.encodeWithSelector(POT_EXIT, pie));
        // Allow adapter to access the _wallet's DAI balance in the vat
        if (vat.can(address(_wallet), address(daiJoin)) == 0) {
            invokeWallet(address(_wallet), address(vat), 0, abi.encodeWithSelector(VAT_HOPE, address(daiJoin)));
        }
        // Check the actual balance of DAI in the vat after the pot exit
        uint bal = vat.dai(address(_wallet));
        // It is necessary to check if due to rounding the exact _amount can be exited by the adapter.
        // Otherwise it will do the maximum DAI balance in the vat
        uint256 withdrawn = bal >= _amount.mul(RAY) ? _amount : bal / RAY;
        invokeWallet(address(_wallet), address(daiJoin), 0, abi.encodeWithSelector(ADAPTER_EXIT, address(_wallet), withdrawn));
    }

    function exitAllDsr(
        BaseWallet _wallet
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        // Execute drip to count the savings accumulated until this moment
        pot.drip();
        // Gets the total pie belonging to the _wallet
        uint256 pie = pot.pie(address(_wallet));
        // Exit DAI from the pot
        invokeWallet(address(_wallet), address(pot), 0, abi.encodeWithSelector(POT_EXIT, pie));
        // Allow adapter to access the _wallet's DAI balance in the vat
        if (vat.can(address(_wallet), address(daiJoin)) == 0) {
            invokeWallet(address(_wallet), address(vat), 0, abi.encodeWithSelector(VAT_HOPE, address(daiJoin)));
        }
        // Exits the DAI amount corresponding to the value of pie
        uint256 withdrawn = pot.chi().mul(pie) / RAY;
        invokeWallet(address(_wallet), address(daiJoin), 0, abi.encodeWithSelector(ADAPTER_EXIT, address(_wallet), withdrawn));
    }

    /* **************************************** SAI <> DAI Conversion **************************************** */

    /**
    * @dev lets the owner convert SCD SAI into MCD DAI.
    * @param _wallet The target wallet.
    * @param _amount The amount of SAI to convert
    */
    function swapSaiToDai(
        BaseWallet _wallet,
        uint256 _amount
    )
        public
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(saiToken.balanceOf(address(_wallet)) >= _amount, "MV2: insufficient SAI");
        invokeWallet(address(_wallet), address(saiToken), 0, abi.encodeWithSelector(ERC20_APPROVE, scdMcdMigration, _amount));
        invokeWallet(address(_wallet), scdMcdMigration, 0, abi.encodeWithSelector(SWAP_SAI_DAI, _amount));
        emit TokenConverted(address(_wallet), address(saiToken), _amount, address(daiToken), _amount);
    }

    /**
    * @dev lets the owner convert MCD DAI into SCD SAI.
    * @param _wallet The target wallet.
    * @param _amount The amount of DAI to convert
    */
    function swapDaiToSai(
        BaseWallet _wallet,
        uint256 _amount
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(daiToken.balanceOf(address(_wallet)) >= _amount, "MV2: insufficient DAI");
        invokeWallet(address(_wallet), address(daiToken), 0, abi.encodeWithSelector(ERC20_APPROVE, scdMcdMigration, _amount));
        invokeWallet(address(_wallet), scdMcdMigration, 0, abi.encodeWithSelector(SWAP_DAI_SAI, _amount));
        emit TokenConverted(address(_wallet), address(daiToken), _amount, address(saiToken), _amount);
    }

    /* ********************************************* CDPs ********************************************* */

    function toInt(uint256 _x) internal pure returns (int _y) {
        _y = int(_x);
        require(_y >= 0, "int-overflow");
    }

    function verifyAuthorizedLoanId(bytes32 _loanId, BaseWallet _wallet) internal view {
        require(cdpOwners[_loanId] == _wallet, "MV2: Unauthorized _loanId");
    }

    function verifySupportedCollateral(address _collateral) internal view {
        if(_collateral != ETH_TOKEN_ADDRESS) {
            (bool collateralSupported,,,) = makerRegistry.collaterals(_collateral);
            require(collateralSupported, "MV2: collateral not supported");
        }
    }

    function joinCollateral(
        BaseWallet _wallet,
        uint256 _cdpId,
        address _collateral,
        uint256 _collateralAmount,
        JoinLike _gemJoin
    ) internal {
        // Send the collateral to the module
        invokeWallet(address(_wallet), _collateral, 0, abi.encodeWithSelector(ERC20_TRANSFER, address(this), _collateralAmount));
        // Approve the adapter to transfer the collateral from the module to itself
        GemLike(_collateral).approve(address(_gemJoin), _collateralAmount);
        // Join collateral to the adapter. The first argument to `join` is the address that *technically* owns the CDP
        _gemJoin.join(cdpManager.urns(_cdpId), _collateralAmount);
    }

     /**
     * @dev Lets the owner of a wallet open a new CDP. The owner must have enough collateral
     * in their wallet.
     * @param _wallet The target wallet
     * @param _collateral The token to use as collateral in the CDP.
     * @param _collateralAmount The amount of collateral to lock in the CDP.
     * @param _daiDebt The amount of DAI to draw from the CDP
     * @return The id of the created CDP.
     */
     // solium-disable-next-line security/no-assign-params
    function openCdp(
        BaseWallet _wallet,
        address _collateral,
        uint256 _collateralAmount,
        uint256 _daiDebt
    )
        internal
        returns (uint256 _cdpId)
    {
        if(_collateral == ETH_TOKEN_ADDRESS) {
            // Convert ETH to WETH
            invokeWallet(address(_wallet), address(wethToken), _collateralAmount, abi.encodeWithSelector(WETH_DEPOSIT));
            // Continue with WETH as collateral instead of ETH
            _collateral = address(wethToken);
        }
        // Get the adapter and ilk for the collateral
        (JoinLike gemJoin, bytes32 ilk) = makerRegistry.getCollateral(_collateral);
        // Open a CDP (the CDP owner will effectively be the module)
        _cdpId = cdpManager.open(ilk, address(this));
        // Move the collateral from the wallet to the vat
        joinCollateral(_wallet, _cdpId, _collateral, _collateralAmount, gemJoin);
        // Get the accumulated rate for the collateral type
        (, uint rate,,,) = vat.ilks(ilk);
        // Express the debt in the RAD units used internally by the vat
        uint daiDebtInRad = _daiDebt.mul(RAY);
        // Lock the collateral and draw the debt. To avoid rounding issues we add an extra wei of debt
        cdpManager.frob(_cdpId, toInt(_collateralAmount), toInt(daiDebtInRad.div(rate) + 1));
        // Transfer the (internal) DAI debt from the cdp's urn to the module.
        cdpManager.move(_cdpId, address(this), daiDebtInRad);
        // Mint the DAI token and exit it to the user's wallet
        daiJoin.exit(address(_wallet), _daiDebt);
    }

    /**
     * @dev Lets the owner of a CDP add more collateral to their CDP. The owner must have enough of the
     * collateral token in their wallet.
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     * @param _collateral The token to use as collateral in the CDP.
     * @param _collateralAmount The amount of collateral to add to the CDP.
     */
    // solium-disable-next-line security/no-assign-params
    function addCollateral(
        BaseWallet _wallet,
        uint256 _cdpId,
        address _collateral,
        uint256 _collateralAmount
    )
        internal
    {
        if(_collateral == ETH_TOKEN_ADDRESS) {
            // Convert ETH to WETH
            invokeWallet(address(_wallet), address(wethToken), _collateralAmount, abi.encodeWithSelector(WETH_DEPOSIT));
            // Continue with WETH as collateral instead of ETH
            _collateral = address(wethToken);
        }
        // Get the adapter for the collateral
        (JoinLike gemJoin,) = makerRegistry.getCollateral(_collateral);
        // Move the collateral from the wallet to the vat
        joinCollateral(_wallet, _cdpId, _collateral, _collateralAmount, gemJoin);
        // Lock the collateral
        cdpManager.frob(_cdpId, toInt(_collateralAmount), 0);
    }

    /**
     * @dev Lets the owner of a CDP remove some collateral from their CDP
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     * @param _collateral The token to use as collateral in the CDP.
     * @param _collateralAmount The amount of collateral to remove from the CDP.
     */
    function removeCollateral(
        BaseWallet _wallet,
        uint256 _cdpId,
        address _collateral,
        uint256 _collateralAmount
    )
        internal
    {
        // Use WETH as collateral instead of ETH if required
        address wrappedCollateral = (_collateral == ETH_TOKEN_ADDRESS) ? address(wethToken) : _collateral;
        // Get the adapter and ilk for the collateral
        (JoinLike gemJoin, bytes32 ilk) = makerRegistry.getCollateral(wrappedCollateral);
        // Unlock the collateral
        cdpManager.frob(_cdpId, -toInt(_collateralAmount), 0);
        // Transfer the (internal) collateral from the cdp's urn to the module.
        cdpManager.flux(ilk, _cdpId, address(this), _collateralAmount);
        // Exit the collateral from the adapter.
        gemJoin.exit(address(_wallet), _collateralAmount);
        if(_collateral == ETH_TOKEN_ADDRESS) {
            // Convert WETH to ETH
            invokeWallet(address(_wallet), address(wethToken), 0, abi.encodeWithSelector(WETH_WITHDRAW, _collateralAmount));
        }
    }

}