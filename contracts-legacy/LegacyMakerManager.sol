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

import "./IUniswapExchange.sol";
import "./IUniswapFactory.sol";
import "./BaseWallet.sol";
import "./BaseModule.sol";
import "./RelayerModule.sol";
import "./OnlyOwnerModule.sol";
import "./Loan.sol";
import "./DSMath.sol";

// Interface to MakerDAO's Tub contract, used to manage CDPs
contract IMakerCdp {
    IDSValue  public pep; // MKR price feed
    IMakerVox public vox; // DAI price feed

    function sai() external view returns (address);  // DAI
    function skr() external view returns (address);  // PETH
    function gem() external view returns (address);  // WETH
    function gov() external view returns (address);  // MKR

    function lad(bytes32 cup) external view returns (address);
    function ink(bytes32 cup) external view returns (uint);
    function tab(bytes32 cup) external returns (uint);
    function rap(bytes32 cup) external returns (uint);

    function tag() public view returns (uint wad);
    function mat() public view returns (uint ray);
    function per() public view returns (uint ray);
    function safe(bytes32 cup) external returns (bool);
    function ask(uint wad) public view returns (uint);
    function bid(uint wad) public view returns (uint);

    function open() external returns (bytes32 cup);
    function join(uint wad) external; // Join PETH
    function exit(uint wad) external; // Exit PETH
    function give(bytes32 cup, address guy) external;
    function lock(bytes32 cup, uint wad) external;
    function free(bytes32 cup, uint wad) external;
    function draw(bytes32 cup, uint wad) external;
    function wipe(bytes32 cup, uint wad) external;
    function shut(bytes32 cup) external;
    function bite(bytes32 cup) external;
}

interface IMakerVox {
    function par() external returns (uint);
}

interface IDSValue {
    function peek() external view returns (bytes32, bool);
    function read() external view returns (bytes32);
    function poke(bytes32 wut) external;
    function void() external;
}

/**
 * @title MakerManager
 * @dev Module to borrow tokens with MakerDAO
 * @author Olivier VDB - <olivier@argent.xyz>, Julien Niset - <julien@argent.xyz>
 */
contract LegacyMakerManager is DSMath, Loan, BaseModule, RelayerModule, OnlyOwnerModule {
    bytes32 constant NAME = "MakerManager";

    // The Maker Tub contract
    IMakerCdp public makerCdp;
    // The Uniswap Factory contract
    IUniswapFactory public uniswapFactory;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // Method signatures to reduce gas cost at depoyment
    bytes4 constant internal CDP_DRAW = bytes4(keccak256("draw(bytes32,uint256)"));
    bytes4 constant internal CDP_WIPE = bytes4(keccak256("wipe(bytes32,uint256)"));
    bytes4 constant internal CDP_SHUT = bytes4(keccak256("shut(bytes32)"));
    bytes4 constant internal CDP_JOIN = bytes4(keccak256("join(uint256)"));
    bytes4 constant internal CDP_LOCK = bytes4(keccak256("lock(bytes32,uint256)"));
    bytes4 constant internal CDP_FREE = bytes4(keccak256("free(bytes32,uint256)"));
    bytes4 constant internal CDP_EXIT = bytes4(keccak256("exit(uint256)"));
    bytes4 constant internal WETH_DEPOSIT = bytes4(keccak256("deposit()"));
    bytes4 constant internal WETH_WITHDRAW = bytes4(keccak256("withdraw(uint256)"));
    bytes4 constant internal ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 constant internal ETH_TOKEN_SWAP_OUTPUT = bytes4(keccak256("ethToTokenSwapOutput(uint256,uint256)"));
    bytes4 constant internal ETH_TOKEN_SWAP_INPUT = bytes4(keccak256("ethToTokenSwapInput(uint256,uint256)"));
    bytes4 constant internal TOKEN_ETH_SWAP_INPUT = bytes4(keccak256("tokenToEthSwapInput(uint256,uint256,uint256)"));

    using SafeMath for uint256;

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        IMakerCdp _makerCdp,
        IUniswapFactory _uniswapFactory
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        makerCdp = _makerCdp;
        uniswapFactory = _uniswapFactory;
    }

    /* ********************************** Implementation of Loan ************************************* */

   /**
     * @dev Opens a collateralized loan.
     * @param _wallet The target wallet.
     * @param _collateral The token used as a collateral (must be 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE).
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
        require(_collateral == ETH_TOKEN_ADDRESS, "Maker: collateral must be ETH");
        require(_debtToken == makerCdp.sai(), "Maker: debt token must be DAI");
        _loanId = openCdp(_wallet, _collateralAmount, _debtAmount, makerCdp);
        emit LoanOpened(address(_wallet), _loanId, _collateral, _collateralAmount, _debtToken, _debtAmount);
    }

    /**
     * @dev Closes a collateralized loan by repaying all debts (plus interest) and redeeming all collateral (plus interest).
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     */
    function closeLoan(
        BaseWallet _wallet,
        bytes32 _loanId
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        closeCdp(_wallet, _loanId, makerCdp, uniswapFactory);
        emit LoanClosed(address(_wallet), _loanId);
    }

    /**
     * @dev Adds collateral to a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     * @param _collateral The token used as a collateral (must be 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE).
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
        require(_collateral == ETH_TOKEN_ADDRESS, "Maker: collateral must be ETH");
        addCollateral(_wallet, _loanId, _collateralAmount, makerCdp);
        emit CollateralAdded(address(_wallet), _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Removes collateral from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     * @param _collateral The token used as a collateral (must be 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE).
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
        require(_collateral == ETH_TOKEN_ADDRESS, "Maker: collateral must be ETH");
        removeCollateral(_wallet, _loanId, _collateralAmount, makerCdp);
        emit CollateralRemoved(address(_wallet), _loanId, _collateral, _collateralAmount);
    }

    /**
     * @dev Increases the debt by borrowing more token from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     * @param _debtToken The token borrowed (must be the address of the DAI contract).
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
        require(_debtToken == makerCdp.sai(), "Maker: debt token must be DAI");
        addDebt(_wallet, _loanId, _debtAmount, makerCdp);
        emit DebtAdded(address(_wallet), _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Decreases the debt by repaying some token from a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     * @param _debtToken The token to repay (must be the address of the DAI contract).
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
        require(_debtToken == makerCdp.sai(), "Maker: debt token must be DAI");
        removeDebt(_wallet, _loanId, _debtAmount, makerCdp, uniswapFactory);
        emit DebtRemoved(address(_wallet), _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Gets information about a loan identified by its ID.
     * @param _loanId The ID of the target CDP.
     * @return a status [0: no loan, 1: loan is safe, 2: loan is unsafe and can be liquidated, 3: loan exists but we are unable to provide info]
     * and a value (in ETH) representing the value that could still be borrowed when status = 1; or the value of the collateral that should be added to
     * avoid liquidation when status = 2.
     */
    function getLoan(
        BaseWallet /* _wallet */,
        bytes32 _loanId
    )
        external
        view
        returns (uint8 _status, uint256 _ethValue)
    {
        if (exists(_loanId, makerCdp)) {
            return (3,0);
        }
        return (0,0);
    }

    /* *********************************** Maker wrappers ************************************* */

    /* CDP actions */

    /**
     * @dev Lets the owner of a wallet open a new CDP. The owner must have enough ether
     * in their wallet. The required amount of ether will be automatically converted to
     * PETH and used as collateral in the CDP.
     * @param _wallet The target wallet
     * @param _pethCollateral The amount of PETH to lock as collateral in the CDP.
     * @param _daiDebt The amount of DAI to draw from the CDP
     * @param _makerCdp The Maker CDP contract
     * @return The id of the created CDP.
     */
    function openCdp(
        BaseWallet _wallet,
        uint256 _pethCollateral,
        uint256 _daiDebt,
        IMakerCdp _makerCdp
    )
        internal
        returns (bytes32 _cup)
    {
        // Open CDP (CDP owner will be module)
        _cup = _makerCdp.open();
        // Transfer CDP ownership to wallet
        _makerCdp.give(_cup, address(_wallet));
        // Convert ETH to PETH & lock PETH into CDP
        lockETH(_wallet, _cup, _pethCollateral, _makerCdp);
        // Draw DAI from CDP
        if (_daiDebt > 0) {
            invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_DRAW, _cup, _daiDebt));
        }
    }

    /**
     * @dev Lets the owner of a CDP add more collateral to their CDP. The owner must have enough ether
     * in their wallet. The required amount of ether will be automatically converted to
     * PETH and locked in the CDP.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of additional PETH to lock as collateral in the CDP.
     * @param _makerCdp The Maker CDP contract
     */
    function addCollateral(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _amount,
        IMakerCdp _makerCdp
    )
        internal
    {
        // _wallet must be owner of CDP
        require(address(_wallet) == _makerCdp.lad(_cup), "CM: not CDP owner");
        // convert ETH to PETH & lock PETH into CDP
        lockETH(_wallet, _cup, _amount, _makerCdp);
    }

    /**
     * @dev Lets the owner of a CDP remove some collateral from their CDP
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of PETH to remove from the CDP.
     * @param _makerCdp The Maker CDP contract
     */
    function removeCollateral(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _amount,
        IMakerCdp _makerCdp
    )
        internal
    {
        // unlock PETH from CDP & convert PETH to ETH
        freeETH(_wallet, _cup, _amount, _makerCdp);
    }

    /**
     * @dev Lets the owner of a CDP draw more DAI from their CDP.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of additional DAI to draw from the CDP.
     * @param _makerCdp The Maker CDP contract
     */
    function addDebt(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _amount,
        IMakerCdp _makerCdp
    )
        internal
    {
        // draw DAI from CDP
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_DRAW, _cup, _amount));
    }

    /**
     * @dev Lets the owner of a CDP partially repay their debt. The repayment is made up of
     * the outstanding DAI debt (including the stability fee if non-zero) plus the MKR governance fee.
     * The method will use the user's MKR tokens in priority and will, if needed, convert the required
     * amount of ETH to cover for any missing MKR tokens.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of DAI debt to repay.
     * @param _makerCdp The Maker CDP contract
     * @param _uniswapFactory The Uniswap Factory contract.
     */
    function removeDebt(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _amount,
        IMakerCdp _makerCdp,
        IUniswapFactory _uniswapFactory
    )
        internal
    {
        // _wallet must be owner of CDP
        require(address(_wallet) == _makerCdp.lad(_cup), "CM: not CDP owner");
        // get governance fee in MKR
        uint256 mkrFee = governanceFeeInMKR(_cup, _amount, _makerCdp);
        // get MKR balance
        address mkrToken = _makerCdp.gov();
        uint256 mkrBalance = ERC20(mkrToken).balanceOf(address(_wallet));
        if (mkrBalance < mkrFee) {
            // Not enough MKR => Convert some ETH into MKR with Uniswap
            address mkrUniswap = _uniswapFactory.getExchange(mkrToken);
            uint256 etherValueOfMKR = IUniswapExchange(mkrUniswap).getEthToTokenOutputPrice(mkrFee - mkrBalance);
            invokeWallet(address(_wallet), mkrUniswap, etherValueOfMKR, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, mkrFee - mkrBalance, block.timestamp));
        }

        // get DAI balance
        address daiToken = _makerCdp.sai();
        uint256 daiBalance = ERC20(daiToken).balanceOf(address(_wallet));
        if (daiBalance < _amount) {
            // Not enough DAI => Convert some ETH into DAI with Uniswap
            address daiUniswap = _uniswapFactory.getExchange(daiToken);
            uint256 etherValueOfDAI = IUniswapExchange(daiUniswap).getEthToTokenOutputPrice(_amount - daiBalance);
            invokeWallet(address(_wallet), daiUniswap, etherValueOfDAI, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, _amount - daiBalance, block.timestamp));
        }

        // Approve DAI to let wipe() repay the DAI debt
        invokeWallet(address(_wallet), daiToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), _amount));
        // Approve MKR to let wipe() pay the MKR governance fee
        invokeWallet(address(_wallet), mkrToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), mkrFee));
        // repay DAI debt and MKR governance fee
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_WIPE, _cup, _amount));
    }

    /**
     * @dev Lets the owner of a CDP close their CDP. The method will 1) repay all debt
     * and governance fee, 2) free all collateral, and 3) delete the CDP.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @param _uniswapFactory The Uniswap Factory contract.
     */
    function closeCdp(
        BaseWallet _wallet,
        bytes32 _cup,
        IMakerCdp _makerCdp,
        IUniswapFactory _uniswapFactory
    )
        internal
    {
        // repay all debt (in DAI) + stability fee (in DAI) + governance fee (in MKR)
        uint debt = daiDebt(_cup, _makerCdp);
        if (debt > 0)
            removeDebt(_wallet, _cup, debt, _makerCdp, _uniswapFactory);
        // free all ETH collateral
        uint collateral = pethCollateral(_cup, _makerCdp);
        if (collateral > 0)
            removeCollateral(_wallet, _cup, collateral, _makerCdp);
        // shut the CDP
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_SHUT, _cup));
    }

    /* Convenience methods */

    /**
     * @dev Returns the amount of PETH collateral locked in a CDP.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return the amount of PETH locked in the CDP.
     */
    function pethCollateral(bytes32 _cup, IMakerCdp _makerCdp) public view returns (uint256) {
        return _makerCdp.ink(_cup);
    }

    /**
     * @dev Returns the amount of DAI debt (including the stability fee if non-zero) drawn from a CDP.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return the amount of DAI drawn from the CDP.
     */
    function daiDebt(bytes32 _cup, IMakerCdp _makerCdp) public returns (uint256) {
        return _makerCdp.tab(_cup);
    }

    /**
     * @dev Indicates whether a CDP is above the liquidation ratio.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return false if the CDP is in danger of being liquidated.
     */
    function isSafe(bytes32 _cup, IMakerCdp _makerCdp) public returns (bool) {
        return _makerCdp.safe(_cup);
    }

    /**
     * @dev Checks if a CDP exists.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return true if the CDP exists, false otherwise.
     */
    function exists(bytes32 _cup, IMakerCdp _makerCdp) public view returns (bool) {
        return _makerCdp.lad(_cup) != address(0);
    }

    /**
     * @dev Max amount of DAI that can still be drawn from a CDP while keeping it above the liquidation ratio.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return the amount of DAI that can still be drawn from a CDP while keeping it above the liquidation ratio.
     */
    function maxDaiDrawable(bytes32 _cup, IMakerCdp _makerCdp) public returns (uint256) {
        uint256 maxTab = rdiv(rdiv(rmul(_makerCdp.ink(_cup), _makerCdp.tag()), _makerCdp.vox().par()), _makerCdp.mat());
        return maxTab.sub(_makerCdp.tab(_cup));
    }

    /**
     * @dev Min amount of collateral that needs to be added to a CDP to bring it above the liquidation ratio.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return the amount of collateral that needs to be added to a CDP to bring it above the liquidation ratio.
     */
    function minCollateralRequired(bytes32 _cup, IMakerCdp _makerCdp) public returns (uint256) {
        uint256 minInk = rdiv(rmul(rmul(_makerCdp.tab(_cup), _makerCdp.mat()), _makerCdp.vox().par()), _makerCdp.tag());
        return minInk.sub(_makerCdp.ink(_cup));
    }

    /**
     * @dev Returns the governance fee in MKR.
     * @param _cup The id of the CDP.
     * @param _daiRefund The amount of DAI debt being repaid.
     * @param _makerCdp The Maker CDP contract
     * @return the governance fee in MKR
     */
    function governanceFeeInMKR(bytes32 _cup, uint256 _daiRefund, IMakerCdp _makerCdp) public returns (uint256 _fee) {
        uint debt = daiDebt(_cup, _makerCdp);
        if (debt == 0)
            return 0;
        uint256 feeInDAI = rmul(_daiRefund, rdiv(_makerCdp.rap(_cup), debt));
        (bytes32 daiPerMKR, bool ok) = _makerCdp.pep().peek();
        if (ok && daiPerMKR != 0)
            _fee = wdiv(feeInDAI, uint(daiPerMKR));
    }

    /**
     * @dev Returns the total MKR governance fee to be paid before this CDP can be closed.
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return the total governance fee in MKR
     */
    function totalGovernanceFeeInMKR(bytes32 _cup, IMakerCdp _makerCdp) external returns (uint256 _fee) {
        return governanceFeeInMKR(_cup, daiDebt(_cup, _makerCdp), _makerCdp);
    }

    /**
     * @dev Minimum amount of PETH that must be locked in a CDP for it to be deemed "safe"
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return The minimum amount of PETH to lock in the CDP
     */
    function minRequiredCollateral(bytes32 _cup, IMakerCdp _makerCdp) public returns (uint256 _minCollateral) {
        _minCollateral = rdiv(
            rmul(
                rmul(
                    rmul(daiDebt(_cup, _makerCdp), _makerCdp.vox().par()), // DAI debt x ~1 USD/DAI
                    _makerCdp.mat()),           // x 1.5
                1010000000000000000000000000),  // x (1+1%) cushion
            _makerCdp.tag());                  // ÷ ~170 USD/PETH
    }

    /* *********************************** Utilities ************************************* */

    /**
     * @dev Converts a user's ETH into PETH and locks the PETH in a CDP
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _pethAmount The amount of PETH to buy and lock
     * @param _makerCdp The Maker CDP contract
     */
    function lockETH(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _pethAmount,
        IMakerCdp _makerCdp
    )
        internal
    {
        // 1. Convert ETH to PETH
        address wethToken = _makerCdp.gem();
        // Get WETH/PETH rate
        uint ethAmount = _makerCdp.ask(_pethAmount);
        // ETH to WETH
        invokeWallet(address(_wallet), wethToken, ethAmount, abi.encodeWithSelector(WETH_DEPOSIT));
        // Approve WETH
        invokeWallet(address(_wallet), wethToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), ethAmount));
        // WETH to PETH
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_JOIN, _pethAmount));

        // 2. Lock PETH into CDP
        address pethToken = _makerCdp.skr();
        // Approve PETH
        invokeWallet(address(_wallet), pethToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), _pethAmount));
        // lock PETH into CDP
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_LOCK, _cup, _pethAmount));
    }

    /**
     * @dev Unlocks PETH from a user's CDP and converts it back to ETH
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _pethAmount The amount of PETH to unlock and sell
     * @param _makerCdp The Maker CDP contract
     */
    function freeETH(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _pethAmount,
        IMakerCdp _makerCdp
    )
        internal
    {
        // 1. Unlock PETH

        // Unlock PETH from CDP
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_FREE, _cup, _pethAmount));

        // 2. Convert PETH to ETH
        address wethToken = _makerCdp.gem();
        address pethToken = _makerCdp.skr();
        // Approve PETH
        invokeWallet(address(_wallet), pethToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), _pethAmount));
        // PETH to WETH
        invokeWallet(address(_wallet), address(_makerCdp), 0, abi.encodeWithSelector(CDP_EXIT, _pethAmount));
        // Get WETH/PETH rate
        uint ethAmount = _makerCdp.bid(_pethAmount);
        // WETH to ETH
        invokeWallet(address(_wallet), wethToken, 0, abi.encodeWithSelector(WETH_WITHDRAW, ethAmount));
    }

    /**
     * @dev Conversion rate between DAI and MKR
     * @param _makerCdp The Maker CDP contract
     * @return The amount of DAI per MKR
     */
    function daiPerMkr(IMakerCdp _makerCdp) internal view returns (uint256 _daiPerMKR) {
        (bytes32 daiPerMKR_, bool ok) = _makerCdp.pep().peek();
        require(ok && daiPerMKR_ != 0, "LM: invalid DAI/MKR rate");
        _daiPerMKR = uint256(daiPerMKR_);
    }
}
