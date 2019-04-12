pragma solidity ^0.5.4;

import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";
import "./TokenExchanger.sol";
import "../cdp/IMakerCdp.sol";
import "../utils/SafeMath.sol";
import "../exchange/ERC20.sol";

/**
 * @title CdpManager
 * @dev Module to manage MakerDAO CDPs,
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract CdpManager is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "CdpManager";
    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // Multiplicative factor applied to the ether value of the MKR governance
    // fee to take into account the Kyber spread (in 1-per-10000)
    uint256 constant internal MKR_ETH_SPREAD = 11000;

    using SafeMath for uint256;

    // The Guardian storage 
    GuardianStorage public guardianStorage;
    // The Token exchanger
    TokenExchanger public tokenExchanger;
    // MarkerDAO's "Tub" contract
    IMakerCdp public makerCdp;
    // WETH Token Contract address
    address public wethToken;
    // PETH Token Contract address
    address public pethToken;
    // DAI Token Contract address
    address public daiToken;
    // MKR Token Contract address
    address public mkrToken;

    // *************** Events *************************** //

    event CdpOpened(address indexed wallet, bytes32 cup, uint256 pethCollateral, uint256 daiDebt);    
    event CdpUpdated(address indexed wallet, bytes32 cup, uint256 pethCollateral, uint256 daiDebt);    
    event CdpClosed(address indexed wallet, bytes32 cup);

    // *************** Modifiers *************************** //

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "NT: wallet must be unlocked");
        _;
    }

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        TokenExchanger _tokenExchanger,
        IMakerCdp _makerCdp,
        address _wethToken,
        address _pethToken,
        address _daiToken,
        address _mkrToken
    ) 
        BaseModule(_registry, NAME)
        public 
    {
        guardianStorage = _guardianStorage;
        tokenExchanger = _tokenExchanger;
        makerCdp = _makerCdp;
        wethToken = _wethToken;
        pethToken = _pethToken;
        daiToken = _daiToken;
        mkrToken = _mkrToken;
    }

    // *************** External/Public Functions ********************* //

    // Convenience methods

    /**
     * @dev Returns the amount of PETH collateral locked in a CDP.
     * @param _cup The id of the CDP.
     * @return the amount of PETH locked in the CDP.
     */
    function pethCollateral(bytes32 _cup) public view returns (uint256) { 
        return makerCdp.ink(_cup);
    }

    /**
     * @dev Returns the amount of DAI debt (including the stability fee if non-zero) drawn from a CDP.
     * @param _cup The id of the CDP.
     * @return the amount of DAI drawn from the CDP.
     */
    function daiDebt(bytes32 _cup) public returns (uint256) { 
        return makerCdp.tab(_cup);
    }

    /**
     * @dev Indicates whether a CDP is above the liquidation ratio.
     * @param _cup The id of the CDP.
     * @return false if the CDP is in danger of being liquidated.
     */
    function isSafe(bytes32 _cup) public returns (bool) { 
        return makerCdp.safe(_cup);
    }

    /**
     * @dev Returns the governance fee in MKR.
     * @param _cup The id of the CDP.
     * @param _daiRefund The amount of DAI debt being repaid.
     * @return the governance fee in MKR
     */
    function governanceFeeInMKR(bytes32 _cup, uint256 _daiRefund) public returns (uint256 _fee) { 
        uint256 feeInDAI = _daiRefund.rmul(makerCdp.rap(_cup).rdiv(makerCdp.tab(_cup)));
        (bytes32 daiPerMKR, bool ok) = makerCdp.pep().peek();
        if (ok && daiPerMKR != 0) _fee = feeInDAI.wdiv(uint(daiPerMKR));
    }

    /**
     * @dev Returns the total MKR governance fee to be paid before this CDP can be closed.
     * @param _cup The id of the CDP.
     * @return the total governance fee in MKR
     */
    function totalGovernanceFeeInMKR(bytes32 _cup) external returns (uint256 _fee) { 
        return governanceFeeInMKR(_cup, daiDebt(_cup));
    }

    // CDP actions

    /**
     * @dev Lets the owner of a wallet open a new CDP. The owner must have enough ether 
     * in their wallet. The required amount of ether will be automatically converted to 
     * PETH and used as collateral in the CDP.
     * @param _wallet The target wallet
     * @param _pethCollateral The amount of PETH to lock as collateral in the CDP.
     * @param _daiDebt The amount of DAI to draw from the CDP
     * @return The id of the created CDP.
     */
    function openCdp(
        BaseWallet _wallet, 
        uint256 _pethCollateral, 
        uint256 _daiDebt
    ) 
        public 
        onlyOwner(_wallet) 
        onlyWhenUnlocked(_wallet)
        returns (bytes32 _cup)
    {
        // Open CDP (CDP owner will be module)
        _cup = makerCdp.open();
        // Transfer CDP ownership to wallet
        makerCdp.give(_cup, address(_wallet));
        // Convert ETH to PETH & lock PETH into CDP
        lockETH(_wallet, _cup, _pethCollateral);
        // Draw DAI from CDP
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("draw(bytes32,uint256)", _cup, _daiDebt));
        // Emit CdpOpened
        emit CdpOpened(address(_wallet), _cup, _pethCollateral, _daiDebt);  
        // Return the CDP id
        return _cup;  
    }

    /**
     * @dev Lets the owner of a CDP add more collateral to their CDP. The owner must have enough ether 
     * in their wallet. The required amount of ether will be automatically converted to 
     * PETH and locked in the CDP.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of additional PETH to lock as collateral in the CDP.
     */
    function addCollateral(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _amount
    ) 
        external
        onlyOwner(_wallet) 
        onlyWhenUnlocked(_wallet)
    {
        // _wallet must be owner of CDP
        require(address(_wallet) == makerCdp.lad(_cup), "CM: Wallet doesn't own CDP");
        // convert ETH to PETH & lock PETH into CDP
        lockETH(_wallet, _cup, _amount);
        // emit CdpUpdated
        emit CdpUpdated(address(_wallet), _cup, pethCollateral(_cup), daiDebt(_cup));    
    }

    /**
     * @dev Lets the owner of a CDP remove some collateral from their CDP
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of PETH to remove from the CDP.
     */
    function removeCollateral(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _amount
    ) 
        public
        onlyOwner(_wallet) 
        onlyWhenUnlocked(_wallet)
    {
        // unlock PETH from CDP & convert PETH to ETH
        freeETH(_wallet, _cup, _amount);
        // emit CdpUpdated
        emit CdpUpdated(address(_wallet), _cup, pethCollateral(_cup), daiDebt(_cup));    
    }

    /**
     * @dev Lets the owner of a CDP draw more DAI from their CDP.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of additional DAI to draw from the CDP.
     */
    function addDebt(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _amount
    ) 
        external
        onlyOwner(_wallet) 
        onlyWhenUnlocked(_wallet)
    {
        // draw DAI from CDP
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("draw(bytes32,uint256)", _cup, _amount));
        // emit CdpUpdated
        emit CdpUpdated(address(_wallet), _cup, pethCollateral(_cup), daiDebt(_cup));    
    }

    /**
     * @dev Lets the owner of a CDP partially repay their debt. The repayment is made up of 
     * the outstanding DAI debt (including the stability fee if non-zero) plus the MKR governance fee.
     * The method will use the user's MKR tokens in priority and will, if needed, convert the required 
     * amount of ETH to cover for any missing MKR tokens.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _amount The amount of DAI debt to repay.
     * @param _minConversionRate The minimum accepted rate for the ETH to MKR conversion.
     */
    function removeDebt(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _amount,
        uint256 _minConversionRate
    ) 
        public
        onlyOwner(_wallet) 
        onlyWhenUnlocked(_wallet)
    {
        // _wallet must be owner of CDP
        require(address(_wallet) == makerCdp.lad(_cup), "CM: Wallet doesn't own CDP");
        // get governance fee in MKR
        uint256 mkrFee = governanceFeeInMKR(_cup, _amount);
        // get MKR balance
        uint256 mkrBalance = ERC20(mkrToken).balanceOf(address(_wallet));
        if (mkrBalance < mkrFee) {
            // Not enough MKR => Convert some ETH into MKR
            (uint256 etherValueOfMKR,,) = tokenExchanger.getExpectedTrade(mkrToken, ETH_TOKEN_ADDRESS, mkrFee - mkrBalance);
            tokenExchanger.trade(    
                _wallet,
                ETH_TOKEN_ADDRESS,
                etherValueOfMKR * MKR_ETH_SPREAD / 10000,
                mkrToken,
                mkrFee - mkrBalance,
                _minConversionRate
            );
        }

        // Approve DAI to let wipe() repay the DAI debt
        _wallet.invoke(daiToken, 0, abi.encodeWithSignature("approve(address,uint256)", address(makerCdp), _amount));
        // Approve MKR to let wipe() pay the MKR governance fee
        _wallet.invoke(mkrToken, 0, abi.encodeWithSignature("approve(address,uint256)", address(makerCdp), mkrFee));
        // repay DAI debt and MKR governance fee
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("wipe(bytes32,uint256)", _cup, _amount));
        // emit CdpUpdated
        emit CdpUpdated(address(_wallet), _cup, pethCollateral(_cup), daiDebt(_cup));    
    }

    /**
     * @dev Lets the owner of a CDP close their CDP. The method will 1) repay all debt 
     * and governance fee, 2) free all collateral, and 3) delete the CDP.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _minConversionRate The minimum accepted rate for the ETH to MKR conversion.
     */
    function closeCdp(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _minConversionRate
    ) 
        external
    {
        // repay all debt (in DAI) + stability fee (in DAI) + governance fee (in MKR)
        removeDebt(_wallet, _cup, daiDebt(_cup), _minConversionRate);
        // free all ETH collateral
        removeCollateral(_wallet, _cup, pethCollateral(_cup));
        // shut the CDP
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("shut(bytes32)", _cup));
        // emit CdpClosed
        emit CdpClosed(address(_wallet), _cup);    
    }


    // *************** Internal Functions ********************* //

    /**
     * @dev Converts a user's ETH into PETH and locks the PETH in a CDP
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _pethAmount The amount of PETH to buy and lock
     */
    function lockETH(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _pethAmount
    ) 
        internal 
    {
        // 1. Convert ETH to PETH

        // Get WETH/PETH rate
        uint ethAmount = makerCdp.ask(_pethAmount);
        // ETH to WETH
        _wallet.invoke(wethToken, ethAmount, abi.encodeWithSignature("deposit"));
        // Approve WETH
        _wallet.invoke(wethToken, 0, abi.encodeWithSignature("approve(address,uint256)", address(makerCdp), ethAmount));
        // WETH to PETH
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("join(uint256)", _pethAmount));

        // 2. Lock PETH into CDP

        // Approve PETH
        _wallet.invoke(pethToken, 0, abi.encodeWithSignature("approve(address,uint256)", address(makerCdp), _pethAmount));
        // lock PETH into CDP
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("lock(bytes32,uint256)", _cup, _pethAmount));
    }

    /**
     * @dev Unlocks PETH from a user's CDP and converts it back to ETH
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _pethAmount The amount of PETH to unlock and sell
     */
    function freeETH(
        BaseWallet _wallet, 
        bytes32 _cup,
        uint256 _pethAmount
    ) 
        internal 
    {
        // 1. Unlock PETH

        // Unlock PETH from CDP
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("free(bytes32,uint256)", _cup, _pethAmount));

        // 2. Convert PETH to ETH

        // Approve PETH
        _wallet.invoke(pethToken, 0, abi.encodeWithSignature("approve(address,uint256)", address(makerCdp), _pethAmount));
        // PETH to WETH
        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("exit(uint256)", _pethAmount));
        // Get WETH/PETH rate
        uint ethAmount = makerCdp.bid(_pethAmount);
        // WETH to ETH
        _wallet.invoke(wethToken, 0, abi.encodeWithSignature("withdraw(uint256)", ethAmount));
    }
}