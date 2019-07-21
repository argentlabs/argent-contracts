pragma solidity ^0.5.4;

import "../utils/SafeMath.sol";
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";
import "../defi/Loan.sol";
// import "../defi/Leverage.sol";

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

interface UniswapFactory {
    function getExchange(address _token) external view returns(address);
}

interface UniswapExchange {
    function getEthToTokenOutputPrice(uint256 _tokens_bought) external view returns (uint256);
    function getEthToTokenInputPrice(uint256 _eth_sold) external view returns (uint256);
    function getTokenToEthOutputPrice(uint256 _eth_bought) external view returns (uint256);
    function getTokenToEthInputPrice(uint256 _tokens_sold) external view returns (uint256);
}


/**
 * @title MakerManager
 * @dev Module to borrow tokens with MakerDAO
 * @author Olivier VDB - <olivier@argent.xyz>, Julien Niset - <julien@argent.xyz>
 */
contract MakerManager is Loan, /*Leverage,*/ BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "MakerLoanManager";

    // The Guardian storage 
    GuardianStorage public guardianStorage;

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
    bytes4 constant internal WETH_DEPOSIT = bytes4(keccak256("deposit"));
    bytes4 constant internal WETH_WITHDRAW = bytes4(keccak256("withdraw(uint256)"));
    bytes4 constant internal ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 constant internal ETH_TOKEN_SWAP_OUTPUT = bytes4(keccak256("ethToTokenSwapOutput(uint256,uint256)"));
    bytes4 constant internal ETH_TOKEN_SWAP_INPUT = bytes4(keccak256("ethToTokenSwapInput(uint256,uint256)"));
    bytes4 constant internal TOKEN_ETH_SWAP_INPUT = bytes4(keccak256("tokenToEthSwapInput(uint256,uint256,uint256)"));

    using SafeMath for uint256;

    IMakerCdp public makerCdp;
    UniswapFactory public uniswapFactory;

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
        GuardianStorage _guardianStorage,
        IMakerCdp _makerCdp,
        UniswapFactory _uniswapFactory
    )
        BaseModule(_registry, NAME)
        public
    {
        guardianStorage = _guardianStorage;
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
    {
        require(_debtToken == makerCdp.sai(), "Maker: debt token must be DAI");
        removeDebt(_wallet, _loanId, _debtAmount, makerCdp, uniswapFactory);
        emit DebtRemoved(address(_wallet), _loanId, _debtToken, _debtAmount);
    }

    /**
     * @dev Gets information about a loan identified by its ID.
     * @param _wallet The target wallet.
     * @param _loanId The ID of the target CDP.
     * @return a status [0: no loan, 1: loan is safe, 2: loan is unsafe and can be liquidated, 3: loan exists but we are unable to provide info] 
     * and a value (in ETH) representing the value that could still be borrowed when status = 1; or the value of the collateral that should be added to 
     * avoid liquidation when status = 2.      
     */
    function getLoan(
        BaseWallet _wallet, 
        bytes32 _loanId
    ) 
        external 
        view 
        returns (uint8 _status, uint256 _ethValue)
    {
        if(exists(_loanId, makerCdp)) {
            return (3,0);
        }
        return (0,0);
    }

    /* ***************************************************************************************** */

    /* ***************************************************************************************** */

    // ************* Leverage is not part of the current release for Maker ************************* //
    // /**
    //  * @dev Lets the owner of a wallet open a new Leveraged Position to increase their exposure to ETH by means of a CDP. 
    //  * The owner must have enough ether in their wallet to cover the purchase of `_collateralAmount` PETH. 
    //  * This amount of PETH will be locked as collateral in the CDP. The method will then draw an amount of DAI from the CDP
    //  * given by the DAI value of the PETH collateral divided by `_conversionRatio` (which must be greater than 1.5). 
    //  * This DAI will be converted into PETH and added as collateral to the CDP. This operation (drawing DAI,
    //  * converting DAI to PETH and locking the additional PETH into the CDP) is repeated `_iterations` times.
    //  * The wallet owner can increase its leverage by increasing the number of `_iterations` or by decreasing 
    //  * the `_converstionRatio`, resulting in both cases in a lower liquidation ratio for the CDP. 
    //  * @param _wallet The target wallet
    //  * @param _collateral The token used as a collateral.
    //  * @param _collateralAmount The amount of collateral token provided.
    //  * @param _conversionRatio The ratio of "additional collateral" to "additional debt" to use at each iteration
    //  * @param _iterations The number of times the operation "draw more DAI, convert this DAI to PETH, lock this PETH" should be repeated
    //  */
    // function openLeveragedPosition(
    //     BaseWallet _wallet,
    //     address _collateral, 
    //     uint256 _collateralAmount, 
    //     uint256 _conversionRatio,
    //     uint8 _iterations
    // ) 
    //     external
    //     returns (bytes32 _leverageId, uint256 _totalCollateral, uint256 _totalDebt)
    // {
    //     require(_collateral == ETH_TOKEN_ADDRESS, "Maker: collateral must be ETH");
    //     _leverageId = openCdp(_wallet, _collateralAmount, 0, makerCdp);
    //     uint256 daiPerPethRatio = availableDaiPerPeth(_conversionRatio, makerCdp);
    //     uint256 availableCollateral = _collateralAmount;
    //     _totalCollateral = availableCollateral;
    //     uint256 drawnDai;

    //     for(uint8 i = 0; i < _iterations; i++) {
    //         (availableCollateral, drawnDai) = drawMoreDai(_wallet, _leverageId, availableCollateral, daiPerPethRatio, makerCdp, uniswapFactory);
    //         _totalDebt += drawnDai;
    //         _totalCollateral += availableCollateral;
    //     }

    //     emit LeverageOpened(address(_wallet), _leverageId, _collateral, totalCollateral, totalDebt); 
    // }

    // /**
    //  * @dev Lets the owner of a wallet close a previously opened Leveraged Position. 
    //  * The owner must have enough DAI & MKR (or alternatively ETH) in their wallet to cover the initial `_daiPayment` debt repayment.
    //  * After this initial debt repayment, the method tries to "unwind" the CDP by iteratively removing as much collateral as possible,
    //  * converting this collateral into DAI & MKR and repaying the DAI debt (and MKR fee). 
    //  * When the CDP no longer holds any collateral or debt, it is closed.
    //  * @param _wallet The target wallet
    //  * @param _leverageId The id of the CDP used to open the Leveraged Position.
    //  * @param _daiPayment The amount of DAI debt to repay before "unwinding" the CDP.
    //  */
    // function closeLeveragedPosition(
    //     BaseWallet _wallet,
    //     bytes32 _leverageId,
    //     uint256 _daiPayment
    // ) 
    //     external
    // {
    //     if (_daiPayment > 0) {
    //         // Cap the amount being repaid
    //         uint256 daiRepaid = (_daiPayment > daiDebt(_leverageId, makerCdp)) ? daiDebt(_leverageId, makerCdp) : _daiPayment;
    //         // (Partially) repay debt
    //         removeDebt(_wallet, _leverageId, daiRepaid, makerCdp, uniswapFactory);
    //     }

    //     uint256 collateral = makerCdp.ink(_leverageId);
    //     while(collateral > 0) {
    //         // Remove some collateral
    //         uint256 removedCollateral = collateral - minRequiredCollateral(_leverageId, makerCdp); // in PETH
    //         removeCollateral(_wallet, _leverageId, removedCollateral, makerCdp);
    //         collateral -= removedCollateral;

    //         // Check if there is more debt to pay
    //         uint256 tab = daiDebt(_leverageId, makerCdp);
    //         if(tab == 0) break; // no more debt (and no more collateral) left in the CDP. We are done

    //         // Convert removedCollateral into DAI and MKR
    //         (uint256 convertedDai) = convertEthCollateralToDaiAndMkr(
    //             _wallet, 
    //             _leverageId, 
    //             removedCollateral.rmul(makerCdp.per()), // in ETH
    //             tab, 
    //             makerCdp,
    //             uniswapFactory
    //         );

    //         removeDebt(_wallet, _leverageId, convertedDai, makerCdp, uniswapFactory);
    //     }
    //     invokeWallet(_wallet, address(makerCdp), 0, abi.encodeWithSelector(CDP_SHUT, _leverageId));
    //     emit LeverageClosed(address(_wallet), _leverageId, _debtPayment);   
    // }

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
        if(_daiDebt > 0) {
            invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_DRAW, _cup, _daiDebt));
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
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_DRAW, _cup, _amount));
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
        UniswapFactory _uniswapFactory
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
            uint256 etherValueOfMKR = UniswapExchange(mkrUniswap).getEthToTokenOutputPrice(mkrFee - mkrBalance);
            invokeWallet(_wallet, mkrUniswap, etherValueOfMKR, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, mkrFee - mkrBalance, block.timestamp));
        }
        
        // get DAI balance
        address daiToken =_makerCdp.sai();
        uint256 daiBalance = ERC20(daiToken).balanceOf(address(_wallet));
        if (daiBalance < _amount) {
            // Not enough DAI => Convert some ETH into DAI with Uniswap
            address daiUniswap = _uniswapFactory.getExchange(daiToken);
            uint256 etherValueOfDAI = UniswapExchange(daiUniswap).getEthToTokenOutputPrice(_amount - daiBalance);
            invokeWallet(_wallet, daiUniswap, etherValueOfDAI, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, _amount - daiBalance, block.timestamp));
        }

        // Approve DAI to let wipe() repay the DAI debt
        invokeWallet(_wallet, daiToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), _amount));
        // Approve MKR to let wipe() pay the MKR governance fee
        invokeWallet(_wallet, mkrToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), mkrFee));
        // repay DAI debt and MKR governance fee
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_WIPE, _cup, _amount));
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
        UniswapFactory _uniswapFactory
    ) 
        internal
    {
        // repay all debt (in DAI) + stability fee (in DAI) + governance fee (in MKR)
        uint debt = daiDebt(_cup, _makerCdp);
        if(debt > 0) removeDebt(_wallet, _cup, debt, _makerCdp, _uniswapFactory);
        // free all ETH collateral
        uint collateral = pethCollateral(_cup, _makerCdp);
        if(collateral > 0) removeCollateral(_wallet, _cup, collateral, _makerCdp);
        // shut the CDP
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_SHUT, _cup));
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
        uint256 maxTab = _makerCdp.ink(_cup).rmul(_makerCdp.tag()).rdiv(_makerCdp.vox().par()).rdiv(_makerCdp.mat());
        return maxTab.sub(_makerCdp.tab(_cup));
    }

    /**
     * @dev Min amount of collateral that needs to be added to a CDP to bring it above the liquidation ratio. 
     * @param _cup The id of the CDP.
     * @param _makerCdp The Maker CDP contract
     * @return the amount of collateral that needs to be added to a CDP to bring it above the liquidation ratio.
     */
    function minCollateralRequired(bytes32 _cup, IMakerCdp _makerCdp) public returns (uint256) {
        uint256 minInk = _makerCdp.tab(_cup).rmul(_makerCdp.mat()).rmul(_makerCdp.vox().par()).rdiv(_makerCdp.tag());
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
        if (debt == 0) return 0;
        uint256 feeInDAI = _daiRefund.rmul(_makerCdp.rap(_cup).rdiv(debt));
        (bytes32 daiPerMKR, bool ok) = _makerCdp.pep().peek();
        if (ok && daiPerMKR != 0) _fee = feeInDAI.wdiv(uint(daiPerMKR));
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
        _minCollateral = daiDebt(_cup, _makerCdp)    // DAI debt
            .rmul(_makerCdp.vox().par())         // x ~1 USD/DAI 
            .rmul(_makerCdp.mat())               // x 1.5
            .rmul(1010000000000000000000000000) // x (1+1%) cushion
            .rdiv(_makerCdp.tag());              // ÷ ~170 USD/PETH
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
        invokeWallet(_wallet, wethToken, ethAmount, abi.encodeWithSelector(WETH_DEPOSIT));
        // Approve WETH
        invokeWallet(_wallet, wethToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), ethAmount));
        // WETH to PETH
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_JOIN, _pethAmount));

        // 2. Lock PETH into CDP
        address pethToken = _makerCdp.skr();
        // Approve PETH
        invokeWallet(_wallet, pethToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), _pethAmount));
        // lock PETH into CDP
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_LOCK, _cup, _pethAmount));
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
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_FREE, _cup, _pethAmount));

        // 2. Convert PETH to ETH
        address wethToken = _makerCdp.gem();
        address pethToken = _makerCdp.skr();
        // Approve PETH
        invokeWallet(_wallet, pethToken, 0, abi.encodeWithSelector(ERC20_APPROVE, address(_makerCdp), _pethAmount));
        // PETH to WETH
        invokeWallet(_wallet, address(_makerCdp), 0, abi.encodeWithSelector(CDP_EXIT, _pethAmount));
        // Get WETH/PETH rate
        uint ethAmount = _makerCdp.bid(_pethAmount);
        // WETH to ETH
        invokeWallet(_wallet, wethToken, 0, abi.encodeWithSelector(WETH_WITHDRAW, ethAmount));
    }

    
    // /**
    //  * @dev Draw more DAI from the CDP and exchange it to collateral.
    //  * @param _wallet The target wallet
    //  * @param _leverageId The id of the CDP.
    //  * @param _availableCollateral The amount of collateral available in the CDP.
    //  * @param _daiPerPethRatio The ratio of DAI that can be drawn from 1 PETH.
    //  * @param _makerCdp The Maker CDP contract
    //  * @param _uniswapFactory The Uniswap Factory contract used for the exchange.
    //  * @return the amount of DAI that was drawn from the CDP and the amount of collateral that was added.
    //  */
    // function drawMoreDai(
    //     BaseWallet _wallet, 
    //     bytes32 _leverageId, 
    //     uint256 _availableCollateral,
    //     uint256 _daiPerPethRatio,
    //     IMakerCdp _makerCdp,
    //     UniswapFactory _uniswapFactory
    // ) 
    //     internal 
    //     returns (uint256 _nextAvailableCollateral, uint256 _drawnDai)
    // {
    //     // Draw DAI
    //     _drawnDai = _availableCollateral.rmul(_daiPerPethRatio); 
    //     addDebt(_wallet, _leverageId, _drawnDai, _makerCdp);

    //     // Exchange drawn DAI for ETH
    //     address daiToken = _makerCdp.sai();
    //     address daiExchange = _uniswapFactory.getExchange(daiToken);
    //     _nextAvailableCollateral = UniswapExchange(daiExchange).getTokenToEthInputPrice(_drawnDai);
    //     invokeWallet(_wallet, daiToken, 0, abi.encodeWithSelector(ERC20_APPROVE, daiExchange, _drawnDai));
    //     invokeWallet(_wallet, daiExchange, 0, abi.encodeWithSelector(TOKEN_ETH_SWAP_INPUT, _drawnDai, 1, block.timestamp));

    //     // Add ETH as collateral
    //     addCollateral(_wallet, _leverageId, _nextAvailableCollateral, _makerCdp);
    // }

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

    // /**
    //  * @dev Gives the additional amount of DAI that can be drawn from a CDP, given an additional amount of PETH collateral
    //  * @param _conversionRatio The conversion ratio to use (must be greater than 1.5)
    //  * @param _makerCdp The Maker CDP contract
    //  * @return The amount of DAI that can be drawn from the CDP per unit of PETH
    //  */
    // function availableDaiPerPeth(uint256 _conversionRatio, IMakerCdp _makerCdp) internal returns (uint256 _availableDaiPerPeth) {
    //     return _makerCdp.tag()           //   USD/PETH
    //         .rdiv(_makerCdp.vox().par()) // ÷ USD/DAI
    //         .rdiv(_conversionRatio);    // ÷ 1.5 (or more)
    // }

    // /**
    //  * @dev Converts a given amount of ETH collateral into DAI and MKR in proportion 
    //  * to their requirements as debt and fee repayments
    //  * @param _wallet The target wallet
    //  * @param _cup The id of the CDP.
    //  * @param _collateralAmount The amount of ETH collateral to convert
    //  * @param _tab The total amount of DAI debt in the CDP
    //  * @param _makerCdp The Maker CDP contract
    //  * @return the amount of converted DAI
    //  */
    // function convertEthCollateralToDaiAndMkr(
    //     BaseWallet _wallet,
    //     bytes32 _cup,
    //     uint256 _collateralAmount, 
    //     uint256 _tab, 
    //     IMakerCdp _makerCdp,
    //     UniswapFactory _uniswapFactory
    // ) 
    //     internal 
    //     returns (uint256 _convertedDai) 
    // {
    //     address exchange;
    //     uint256 expectedToken;
    //     // Convert a portion of _collateral into DAI
    //     uint256 rap = _makerCdp.rap(_cup); // total MKR governance fee left to pay, converted to DAI
    //     uint256 collateralForDai = _collateralAmount.wmul(_tab).wdiv(_tab + rap);
    //     exchange = _uniswapFactory.getExchange(_makerCdp.sai());
    //     expectedToken = UniswapExchange(exchange).getEthToTokenInputPrice(collateralForDai);
    //     if(expectedToken > _tab) {
    //         invokeWallet(_wallet, exchange, collateralForDai, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, _tab, block.timestamp));
    //         _convertedDai = _tab;
    //     }
    //     else {
    //         invokeWallet(_wallet, exchange, collateralForDai, abi.encodeWithSelector(ETH_TOKEN_SWAP_INPUT, 1, block.timestamp));
    //         _convertedDai = expectedToken;
    //     }
        
    //     // Convert the remaining portion of removedCollateral into MKR
    //     if(rap > 0) {
    //         // Compute MKR fee to pay when repaying _convertedDai DAI
    //         uint256 mkrFee = _convertedDai.rmul(rap.rdiv(_tab)).wdiv(daiPerMkr(_makerCdp));
    //         // Convert the remaining portion of _collateral into MKR
    //         address mkrToken = _makerCdp.gov();
    //         uint256 collateralForMkr = _collateralAmount - collateralForDai;
    //         exchange = _uniswapFactory.getExchange(mkrToken);
    //         expectedToken = UniswapExchange(exchange).getEthToTokenInputPrice(collateralForMkr);
    //         if(expectedToken > mkrFee) {
    //             invokeWallet(_wallet, exchange, collateralForMkr, abi.encodeWithSelector(ETH_TOKEN_SWAP_OUTPUT, mkrFee, block.timestamp));
    //         }
    //         else {
    //             invokeWallet(_wallet, exchange, collateralForMkr, abi.encodeWithSelector(ETH_TOKEN_SWAP_INPUT, 1, block.timestamp));
    //         }
    //     }
    // }

    /**
     * @dev Utility method to invoke a wallet
     * @param _wallet The wallet to invoke.
     * @param _to The target address.
     * @param _value The value.
     * @param _data The data.
     */
    function invokeWallet(BaseWallet _wallet, address _to, uint256 _value, bytes memory _data) internal {
        _wallet.invoke(_to, _value, _data);
    }
} 

