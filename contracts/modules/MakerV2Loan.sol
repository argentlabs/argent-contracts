pragma solidity ^0.5.4;

import "./MakerV2Base.sol";
import "../defi/Loan.sol";
import "../infrastructure/MakerRegistry.sol";

contract JugLike {
    function drip(bytes32) external;
}

interface IUniswapFactory {
    function getExchange(address _token) external view returns(IUniswapExchange);
}

interface IUniswapExchange {
    function getEthToTokenOutputPrice(uint256 _tokens_bought) external view returns (uint256);
    function getEthToTokenInputPrice(uint256 _eth_sold) external view returns (uint256);
    function getTokenToEthOutputPrice(uint256 _eth_bought) external view returns (uint256);
    function getTokenToEthInputPrice(uint256 _tokens_sold) external view returns (uint256);
}

/**
 * @title MakerV2Loan
 * @dev Module to migrate old CDPs and open and manage new CDPs.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract MakerV2Loan is Loan, MakerV2Base {

    // The address of the MKR token
    GemLike internal mkrToken;
    // The address of the WETH token
    GemLike internal wethToken;
    // The address of the WETH Adapter
    JoinLike internal wethJoin;
    // The address of the Jug
    JugLike internal jug;
    // The address of the CDP Manager
    ManagerLike internal cdpManager;
    // The address of the SCD Tub
    SaiTubLike internal tub;
    // The Maker Registry in which all supported collateral tokens and their adapters are stored
    MakerRegistry internal makerRegistry;
    // The Uniswap Exchange contract for DAI
    IUniswapExchange internal daiUniswap;
    // The Uniswap Exchange contract for MKR
    IUniswapExchange internal mkrUniswap;
    // Mapping [wallet][ilk] -> loanId, that keeps track of cdp owners
    // while also enforcing a maximum of one loan per token (ilk) and per wallet
    // (which will make future upgrades of the module easier)
    mapping(address => mapping(bytes32 => bytes32)) public loanIds;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // Method signatures to reduce gas cost at depoyment
    bytes4 constant internal ERC20_TRANSFER = bytes4(keccak256("transfer(address,uint256)"));
    bytes4 constant internal WETH_DEPOSIT = bytes4(keccak256("deposit()"));
    bytes4 constant internal WETH_WITHDRAW = bytes4(keccak256("withdraw(uint256)"));
    bytes4 constant internal VAT_HOPE = bytes4(keccak256("hope(address)"));
    bytes4 constant internal CDP_GIVE = bytes4(keccak256("give(uint256,address)"));
    bytes4 constant internal TUB_GIVE = bytes4(keccak256("give(bytes32,address)"));
    bytes4 constant internal ETH_TOKEN_SWAP_OUTPUT = bytes4(keccak256("ethToTokenSwapOutput(uint256,uint256)"));

    // ****************** Events *************************** //

    event CdpMigrated(address indexed _wallet, bytes32 _oldCdpId, bytes32 _newCdpId);

    // *************** Modifiers *************************** //

    /**
     * @dev Throws if the sender is not an authorised module.
     */
    modifier onlyModule(BaseWallet _wallet) {
        require(_wallet.authorised(msg.sender), "MV2: sender unauthorized");
        _;
    }

    // *************** Constructor ********************** //

    constructor(
        JugLike _jug,
        MakerRegistry _makerRegistry,
        IUniswapFactory _uniswapFactory
    )
        public
    {
        cdpManager = ScdMcdMigration(scdMcdMigration).cdpManager();
        tub = ScdMcdMigration(scdMcdMigration).tub();
        wethJoin = ScdMcdMigration(scdMcdMigration).wethJoin();
        wethToken = wethJoin.gem();
        mkrToken = tub.gov();
        jug = _jug;
        makerRegistry = _makerRegistry;
        daiUniswap = _uniswapFactory.getExchange(address(daiToken));
        mkrUniswap = _uniswapFactory.getExchange(address(mkrToken));
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
        require(_debtToken == address(daiToken), "MV2: debt token not DAI");
        _loanId = bytes32(openCdp(_wallet, _collateral, _collateralAmount, _debtAmount));
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
        verifyLoanOwner(_wallet, _loanId);
        addCollateral(_wallet, uint256(_loanId), _collateralAmount);
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
        verifyLoanOwner(_wallet, _loanId);
        removeCollateral(_wallet, uint256(_loanId), _collateralAmount);
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
        addDebt(_wallet, uint256(_loanId), _debtAmount);
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
        verifyLoanOwner(_wallet, _loanId);
        updateStabilityFee(uint256(_loanId));
        removeDebt(_wallet, uint256(_loanId), _debtAmount);
        emit DebtRemoved(address(_wallet), _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Closes a collateralized loan by repaying all debts (plus interest) and redeeming all collateral.
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
        verifyLoanOwner(_wallet, _loanId);
        updateStabilityFee(uint256(_loanId));
        closeCdp(_wallet, uint256(_loanId));
        emit LoanClosed(address(_wallet), _loanId);
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
        if(cdpManager.owns(uint256(_loanId)) != address(0)) {
            return (3,0);
        }
        return (0,0);
    }

    /* *************************************** Other CDP methods ***************************************** */

    /**
     * @dev Lets a CDP owner transfer their CDP from their wallet to the present module so the CDP
     * can be managed by the module.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     */
    function acquireLoan(
        BaseWallet _wallet,
        bytes32 _loanId
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        invokeWallet(address(_wallet), address(cdpManager), 0, abi.encodeWithSelector(CDP_GIVE, uint256(_loanId), address(this)));
        saveLoanOwner(_wallet, _loanId);
    }

    /**
     * @dev Lets a SCD CDP owner migrate their CDP to use the new MCD engine.
     * Requires MKR or ETH to pay the SCD governance fee
     * @param _wallet The target wallet.
     * @param _cup id of the old SCD CDP to migrate
     */
    function migrateCdp(
        BaseWallet _wallet,
        bytes32 _cup
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns (bytes32 _loanId)
    {
        (uint daiPerMkr, bool ok) = tub.pep().peek();
        if (ok && daiPerMkr != 0) {
            // get governance fee in MKR
            uint mkrFee = tub.rap(_cup).wdiv(daiPerMkr);
            // Convert some ETH into MKR with Uniswap if necessary
            buyTokens(_wallet, mkrToken, mkrFee, mkrUniswap);
            // Transfer the MKR to the Migration contract
            invokeWallet(address(_wallet), address(mkrToken), 0, abi.encodeWithSelector(ERC20_TRANSFER, address(scdMcdMigration), mkrFee));
        }
        // Transfer ownership of the SCD CDP to the migration contract
        invokeWallet(address(_wallet), address(tub), 0, abi.encodeWithSelector(TUB_GIVE, _cup, address(scdMcdMigration)));
        // Update stability fee rate
        jug.drip(wethJoin.ilk());
        // Execute the CDP migration
        _loanId = bytes32(ScdMcdMigration(scdMcdMigration).migrate(_cup));
        // Record the CDP as belonging to the wallet
        saveLoanOwner(_wallet, _loanId);

        emit CdpMigrated(address(_wallet), _cup, _loanId);
    }

    /**
     * @dev Lets a future upgrade of this module transfer a CDP to itself
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     */
    function giveCdp(
        BaseWallet _wallet,
        bytes32 _loanId
    )
        external
        onlyModule(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        cdpManager.give(uint256(_loanId), msg.sender);
        clearLoanOwner(_wallet, _loanId);
    }

    /* ************************************** Internal Functions ************************************** */

    function toInt(uint256 _x) internal pure returns (int _y) {
        _y = int(_x);
        require(_y >= 0, "int-overflow");
    }

    function saveLoanOwner(BaseWallet _wallet, bytes32 _loanId) internal {
        loanIds[address(_wallet)][cdpManager.ilks(uint256(_loanId))] = _loanId;
    }

    function clearLoanOwner(BaseWallet _wallet, bytes32 _loanId) internal {
        delete loanIds[address(_wallet)][cdpManager.ilks(uint256(_loanId))];
    }

    function verifyLoanOwner(BaseWallet _wallet, bytes32 _loanId) internal view {
        require(loanIds[address(_wallet)][cdpManager.ilks(uint256(_loanId))] == _loanId, "MV2: unauthorized loanId");
    }

    function verifySupportedCollateral(address _collateral) internal view {
        if(_collateral != ETH_TOKEN_ADDRESS) {
            (bool collateralSupported,,,) = makerRegistry.collaterals(_collateral);
            require(collateralSupported, "MV2: unsupported collateral");
        }
    }

    function buyTokens(
        BaseWallet _wallet,
        GemLike _token,
        uint256 _tokenAmountRequired,
        IUniswapExchange _uniswapExchange
    )
        internal
    {
        // get token balance
        uint256 tokenBalance = _token.balanceOf(address(_wallet));
        if (tokenBalance < _tokenAmountRequired) {
            // Not enough tokens => Convert some ETH into tokens with Uniswap
            uint256 etherValueOfTokens = _uniswapExchange.getEthToTokenOutputPrice(_tokenAmountRequired - tokenBalance);
            // solium-disable-next-line security/no-block-members
            invokeWallet(address(_wallet), address(_uniswapExchange), etherValueOfTokens, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, _tokenAmountRequired - tokenBalance, now));
        }
    }

    function joinCollateral(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _collateralAmount,
        bytes32 _ilk
    )
        internal
    {
        // Get the adapter and collateral token for the CDP
        (JoinLike gemJoin, GemLike collateral) = makerRegistry.getCollateral(_ilk);
        // Convert ETH to WETH if needed
        if(gemJoin == wethJoin) {
            invokeWallet(address(_wallet), address(wethToken), _collateralAmount, abi.encodeWithSelector(WETH_DEPOSIT));
        }
        // Send the collateral to the module
        invokeWallet(address(_wallet), address(collateral), 0, abi.encodeWithSelector(ERC20_TRANSFER, address(this), _collateralAmount));
        // Approve the adapter to pull the collateral from the module
        collateral.approve(address(gemJoin), _collateralAmount);
        // Join collateral to the adapter. The first argument to `join` is the address that *technically* owns the CDP
        gemJoin.join(cdpManager.urns(_cdpId), _collateralAmount);
    }

    function joinDebt(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _debtAmount //  art.mul(rate).div(RAY) === [wad]*[ray]/[ray]=[wad]
    ) internal {
        // Send the DAI to the module
        invokeWallet(address(_wallet), address(daiToken), 0, abi.encodeWithSelector(ERC20_TRANSFER, address(this), _debtAmount));
        // Approve the DAI adapter to burn DAI from the module
        daiToken.approve(address(daiJoin), _debtAmount);
        // Join DAI to the adapter. The first argument to `join` is the address that *technically* owns the CDP
        // To avoid rounding issues, we substract one wei to the amount joined
        daiJoin.join(cdpManager.urns(_cdpId), _debtAmount.sub(1));
    }

    function drawAndExitDebt(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _debtAmount,
        uint256 _collateralAmount,
        bytes32 _ilk
    )
        internal
    {
        // Get the accumulated rate for the collateral type
        (, uint rate,,,) = vat.ilks(_ilk);
        // Express the debt in the RAD units used internally by the vat
        uint daiDebtInRad = _debtAmount.mul(RAY);
        // Lock the collateral and draw the debt. To avoid rounding issues we add an extra wei of debt
        cdpManager.frob(_cdpId, toInt(_collateralAmount), toInt(daiDebtInRad.div(rate) + 1));
        // Transfer the (internal) DAI debt from the cdp's urn to the module.
        cdpManager.move(_cdpId, address(this), daiDebtInRad);
        // Mint the DAI token and exit it to the user's wallet
        daiJoin.exit(address(_wallet), _debtAmount);
    }

    function updateStabilityFee(
        uint256 _cdpId
    )
        internal
    {
        jug.drip(cdpManager.ilks(_cdpId));
    }

    function debt(
        uint256 _cdpId
    )
        internal
        view
        returns (uint256 _fullRepayment, uint256 _maxNonFullRepayment)
    {
        bytes32 ilk = cdpManager.ilks(_cdpId);
        (, uint256 art) = vat.urns(ilk, cdpManager.urns(_cdpId));
        if(art > 0) {
            (, uint rate,,, uint dust) = vat.ilks(ilk);
            _maxNonFullRepayment = art.mul(rate).sub(dust).div(RAY);
            _fullRepayment = art.mul(rate).div(RAY)
                .add(1) // the amount approved is 1 wei more than the amount repaid, to avoid rounding issues
                .add(art-art.mul(rate).div(RAY).mul(RAY).div(rate)); // adding 1 extra wei if further rounding issues are expected
        }
    }

    function collateral(
        uint256 _cdpId
    )
        internal
        view
        returns (uint256 _collateralAmount)
    {
        (_collateralAmount,) = vat.urns(cdpManager.ilks(_cdpId), cdpManager.urns(_cdpId));
    }

    function verifyValidRepayment(
        uint256 _cdpId,
        uint256 _debtAmount
    )
        internal
        view
    {
        (uint256 fullRepayment, uint256 maxRepayment) = debt(_cdpId);
        require(_debtAmount <= maxRepayment || _debtAmount == fullRepayment, "MV2: repay full or >dust");
    }

     /**
     * @dev Lets the owner of a wallet open a new CDP. The owner must have enough collateral
     * in their wallet.
     * @param _wallet The target wallet
     * @param _collateral The token to use as collateral in the CDP.
     * @param _collateralAmount The amount of collateral to lock in the CDP.
     * @param _debtAmount The amount of DAI to draw from the CDP
     * @return The id of the created CDP.
     */
    // solium-disable-next-line security/no-assign-params
    function openCdp(
        BaseWallet _wallet,
        address _collateral,
        uint256 _collateralAmount,
        uint256 _debtAmount
    )
        internal
        returns (uint256 _cdpId)
    {
        // Continue with WETH as collateral instead of ETH if needed
        if(_collateral == ETH_TOKEN_ADDRESS) _collateral = address(wethToken);
        // Get the ilk for the collateral
        bytes32 ilk = makerRegistry.getIlk(_collateral);
        // Open a CDP if there isn't already one for the collateral type (the CDP owner will effectively be the module)
        _cdpId = uint256(loanIds[address(_wallet)][ilk]);
        if(_cdpId == 0) _cdpId = cdpManager.open(ilk, address(this));
        // Move the collateral from the wallet to the vat
        joinCollateral(_wallet, _cdpId, _collateralAmount, ilk);
        // Draw the debt and exit it to the wallet
        if(_debtAmount > 0) drawAndExitDebt(_wallet, _cdpId, _debtAmount, _collateralAmount, ilk);
        // Mark the CDP as belonging to the wallet
        saveLoanOwner(_wallet, bytes32(_cdpId));
    }

    /**
     * @dev Lets the owner of a CDP add more collateral to their CDP. The owner must have enough of the
     * collateral token in their wallet.
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     * @param _collateralAmount The amount of collateral to add to the CDP.
     */
    function addCollateral(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _collateralAmount
    )
        internal
    {
        // Move the collateral from the wallet to the vat
        joinCollateral(_wallet, _cdpId, _collateralAmount, cdpManager.ilks(_cdpId));
        // Lock the collateral
        cdpManager.frob(_cdpId, toInt(_collateralAmount), 0);
    }

    /**
     * @dev Lets the owner of a CDP remove some collateral from their CDP
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     * @param _collateralAmount The amount of collateral to remove from the CDP.
     */
    function removeCollateral(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _collateralAmount
    )
        internal
    {
        // Unlock the collateral
        cdpManager.frob(_cdpId, -toInt(_collateralAmount), 0);
        // Transfer the (internal) collateral from the cdp's urn to the module.
        cdpManager.flux(_cdpId, address(this), _collateralAmount);
        // Get the adapter for the collateral
        (JoinLike gemJoin,) = makerRegistry.getCollateral(cdpManager.ilks(_cdpId));
        // Exit the collateral from the adapter.
        gemJoin.exit(address(_wallet), _collateralAmount);
        // Convert WETH to ETH if needed
        if(gemJoin == wethJoin) {
            invokeWallet(address(_wallet), address(wethToken), 0, abi.encodeWithSelector(WETH_WITHDRAW, _collateralAmount));
        }
    }

    /**
     * @dev Lets the owner of a CDP draw more DAI from their CDP.
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     * @param _amount The amount of additional DAI to draw from the CDP.
     */
    function addDebt(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _amount
    )
        internal
    {
        // Draw and exit the debt to the wallet
        drawAndExitDebt(_wallet, _cdpId, _amount, 0, cdpManager.ilks(_cdpId));
    }

    /**
     * @dev Lets the owner of a CDP partially repay their debt. The repayment is made up of
     * the outstanding DAI debt plus the DAI stability fee.
     * The method will use the user's DAI tokens in priority and will, if needed, convert the required
     * amount of ETH to cover for any missing DAI tokens.
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     * @param _amount The amount of DAI debt to repay.
     */
    function removeDebt(
        BaseWallet _wallet,
        uint256 _cdpId,
        uint256 _amount
    )
        internal
    {
        verifyValidRepayment(_cdpId, _amount);
        // Convert some ETH into DAI with Uniswap if necessary
        buyTokens(_wallet, daiToken, _amount, daiUniswap);
        // Move the DAI from the wallet to the vat.
        joinDebt(_wallet, _cdpId, _amount);
        // Get the accumulated rate for the collateral type
        (, uint rate,,,) = vat.ilks(cdpManager.ilks(_cdpId));
        // Repay the debt. To avoid rounding issues we reduce the repayment by one wei
        cdpManager.frob(_cdpId, 0, -toInt(_amount.sub(1).mul(RAY).div(rate)));
    }

    /**
     * @dev Lets the owner of a CDP close their CDP. The method will:
     * 1) repay all debt and fee
     * 2) free all collateral
     * @param _wallet The target wallet
     * @param _cdpId The id of the CDP.
     */
    function closeCdp(
        BaseWallet _wallet,
        uint256 _cdpId
    )
        internal
    {
        (uint256 fullRepayment,) = debt(_cdpId);
        // Repay the debt
        if(fullRepayment > 0) removeDebt(_wallet, _cdpId, fullRepayment);
        // Remove the collateral
        uint256 ink = collateral(_cdpId);
        if(ink > 0) removeCollateral(_wallet, _cdpId, ink);
    }

}