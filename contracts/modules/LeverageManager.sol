pragma solidity ^0.5.4;

import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";
import "./TokenExchanger.sol";
import "./CdpManager.sol";
import "../cdp/IMakerCdp.sol";
import "../utils/SafeMath.sol";

/**
 * @title LeverageManager
 * @dev Module to manage Leveraged Positions via MakerDAO CDPs,
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract LeverageManager is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "LeverageManager";
    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    // // The Guardian storage 
    GuardianStorage public guardianStorage;
    // The Token exchanger
    TokenExchanger public tokenExchanger;
    // The CDP Manager
    CdpManager public cdpManager;
    // MarkerDAO's "Tub" contract
    IMakerCdp public makerCdp;
    // DAI Token Contract address
    address public daiToken;
    // MKR Token Contract address
    address public mkrToken;

    // *************** Events *************************** //

    event LeverageOpened(address indexed wallet, bytes32 cup, uint256 pethCollateral, uint256 daiDebt);    
    event LeverageClosed(address indexed wallet, bytes32 cup);    

    // *************** Modifiers *************************** //

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "CM: wallet locked");
        _;
    }

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        CdpManager _cdpManager
    ) 
        BaseModule(_registry, NAME)
        public 
    {
        guardianStorage = _guardianStorage;
        cdpManager = _cdpManager;
        tokenExchanger = cdpManager.tokenExchanger();
        makerCdp = cdpManager.makerCdp();
        daiToken = cdpManager.daiToken();
        mkrToken = cdpManager.mkrToken();
    }

    // *************** External/Public Functions ********************* //

    /**
     * @dev Lets the owner of a wallet open a new Leveraged Position to increase their exposure to ETH by means of a CDP. 
     * The owner must have enough ether in their wallet to cover the purchase of `_pethCollateral` PETH. 
     * This amount of PETH will be locked as collateral in the CDP. The method will then draw an amount of DAI from the CDP
     * given by the DAI value of the PETH collateral divided by `_conversionRatio` (which must be greater than 1.5). 
     * This DAI will be converted into PETH and added as collateral to the CDP. This operation (drawing DAI,
     * converting DAI to PETH and locking the additional PETH into the CDP) is repeated `_iterations` times.
     * The wallet owner can increase its leverage by increasing the number of `_iterations` or by decreasing 
     * the `_converstionRatio`, resulting in both cases in a lower liquidation ratio for the CDP. 
     * @param _wallet The target wallet
     * @param _pethCollateral The initial amount of PETH to lock as collateral in the CDP.
     * @param _conversionRatio The ratio of "additional collateral" to "additional debt" to use at each iteration
     * @param _iterations The number of times the operation "draw more DAI, convert this DAI to PETH, lock this PETH" should be repeated
     * @param _minEthDaiConversionRate The minimum accepted rate for the ETH to DAI conversion
     */
    function openLeveragedPosition(
        BaseWallet _wallet,
        uint256 _pethCollateral, 
        uint256 _conversionRatio,
        uint8 _iterations,
        uint256 _minEthDaiConversionRate
    ) 
        external
        onlyOwner(_wallet) 
        // onlyWhenUnlocked(_wallet) // (already checked by openCdp())
    {
        bytes32 cup = cdpManager.openCdp(_wallet, _pethCollateral, 0);
        uint256 available_dai_per_peth = availableDaiPerPeth(_conversionRatio);
        uint256 addedCollateral = _pethCollateral;
        uint256 totalCollateral = addedCollateral;
        uint256 totalDebt;
        
        for(uint8 i = 0; i < _iterations; i++) {
            // Draw DAI
            uint256 drawnDAI = addedCollateral.rmul(available_dai_per_peth);
            cdpManager.addDebt(_wallet, cup, drawnDAI);
            totalDebt += drawnDAI;
 
            // Exchange drawn DAI for ETH
            addedCollateral = tokenExchanger.trade(    
                _wallet,
                daiToken,
                drawnDAI,
                ETH_TOKEN_ADDRESS,
                uint256(-1),
                _minEthDaiConversionRate
            );

            // Add ETH as collateral
            cdpManager.addCollateral(_wallet, cup, addedCollateral);
            totalCollateral += addedCollateral;
        }
        emit LeverageOpened(address(_wallet), cup, totalCollateral, totalDebt);
    }

    /**
     * @dev Lets the owner of a wallet close a previously opened Leveraged Position. 
     * The owner must have enough DAI & MKR (or alternatively ETH) in their wallet to cover the initial `_daiPayment` debt repayment.
     * After this initial debt repayment, the method tries to "unwind" the CDP by iteratively removing as much collateral as possible,
     * converting this collateral into DAI & MKR and repaying the DAI debt (and MKR fee). 
     * When the CDP no longer holds any collateral or debt, it is closed.
     * @param _wallet The target wallet
     * @param _cup The id of the CDP used to open the Leveraged Position.
     * @param _daiPayment The amount of DAI debt to repay before "unwinding" the CDP.
     * @param _minEthMkrConversionRate The minimum accepted rate for the ETH to MKR conversion.
     * @param _minEthDaiConversionRate The minimum accepted rate for the ETH to DAI conversion.
     */
    function closeLeveragedPosition(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _daiPayment,
        uint256 _minEthMkrConversionRate,
        uint256 _minEthDaiConversionRate
    ) 
        external
        onlyOwner(_wallet) 
        // onlyWhenUnlocked(_wallet) //(already checked by removeCollateral())
    {

        if (_daiPayment > 0) {
            // Cap the amount being repaid
            uint256 daiRepaid = (_daiPayment > makerCdp.tab(_cup)) ? makerCdp.tab(_cup) : _daiPayment;
            // (Partially) repay debt
            cdpManager.removeDebt(_wallet, _cup, daiRepaid, _minEthMkrConversionRate, _minEthDaiConversionRate);
        }

        uint256 collateral = makerCdp.ink(_cup);
        while(collateral > 0) {
            // Remove some collateral
            uint256 removedCollateral = collateral - minRequiredCollateral(_cup); // in PETH
            cdpManager.removeCollateral(_wallet, _cup, removedCollateral);
            collateral -= removedCollateral;

            // Check if there is more debt to pay
            uint256 tab = makerCdp.tab(_cup);
            if(tab == 0) break; // no more debt (and no more collateral) left in the CDP. We are done

            // Convert removedCollateral into DAI and MKR
            (uint256 convertedDai, uint256 convertedMkr) = convertEthCollateralToDaiAndMkr(
                _wallet, 
                _cup, 
                removedCollateral.rmul(makerCdp.per()), // in ETH
                tab, 
                _minEthMkrConversionRate,
                _minEthDaiConversionRate
            );

            cdpManager.removeDebt(_wallet, _cup, convertedDai, _minEthMkrConversionRate, _minEthDaiConversionRate);
        }

        _wallet.invoke(address(makerCdp), 0, abi.encodeWithSignature("shut(bytes32)", _cup));
        // _wallet.invoke(address(makerCdp), 0, abi.encodeWithSelector(0xb84d2106, _cup));

        emit LeverageClosed(address(_wallet), _cup);
    }

    // *************** Internal Functions ********************* //

    /**
     * @dev Minimum amount of PETH that must be locked in a CDP for it to be deemed "safe"
     * @param _cup The id of the CDP.
     * @return The minimum amount of PETH to lock in the CDP
     */
    function minRequiredCollateral(bytes32 _cup) public returns (uint256 _minCollateral) { 
        _minCollateral = makerCdp.tab(_cup)     // DAI debt
            .rmul(makerCdp.vox().par())         // x ~1 USD/DAI 
            .rmul(makerCdp.mat())               // x 1.5
            .rmul(1010000000000000000000000000) // x (1+1%) cushion
            .rdiv(makerCdp.tag());              // ÷ ~170 USD/PETH
    }

    /**
     * @dev Conversion rate between DAI and MKR
     * @return The amount of DAI per MKR
     */
    function daiPerMkr() internal view returns (uint256 _daiPerMKR) {
        (bytes32 daiPerMKR_, bool ok) = makerCdp.pep().peek();
        require(ok && daiPerMKR_ != 0, "LM: invalid DAI/MKR rate");
        _daiPerMKR = uint256(daiPerMKR_);
    }

    /**
     * @dev Gives the additional amount of DAI that can be drawn from a CDP, given an additional amount of PETH collateral
     * @param _conversionRatio The conversion ratio to use (must be greater than 1.5)
     * @return The amount of DAI that can be drawn from the CDP per unit of PETH
     */
    function availableDaiPerPeth(uint256 _conversionRatio) internal returns (uint256 _availableDaiPerPeth) {
        return makerCdp.tag()           //   USD/PETH
            .rdiv(makerCdp.vox().par()) // ÷ USD/DAI
            .rdiv(_conversionRatio);    // ÷ 1.5 (or more)
    }

    /**
     * @dev Converts a given amount of ETH collateral into DAI and MKR in proportion 
     * to their requirements as debt and fee repayments
     * @param _wallet The target wallet
     * @param _cup The id of the CDP.
     * @param _collateral The amount of ETH collateral to convert
     * @param _tab The total amount of DAI debt in the CDP
     * @param _minEthMkrConversionRate The minimum accepted rate for the ETH to MKR conversion
     * @param _minEthDaiConversionRate The minimum accepted rate for the ETH to DAI conversion.
     * @return the amount of converted DAI and MKR
     */
    function convertEthCollateralToDaiAndMkr(
        BaseWallet _wallet,
        bytes32 _cup,
        uint256 _collateral, 
        uint256 _tab, 
        uint256 _minEthMkrConversionRate, 
        uint256 _minEthDaiConversionRate
    ) internal returns (uint256 _convertedDai, uint256 _convertedMkr) {
        // Convert a portion of _collateral into DAI
        uint256 rap = makerCdp.rap(_cup); // total MKR governance fee left to pay, converted to DAI
        _convertedDai = tokenExchanger.trade(    
            _wallet,
            ETH_TOKEN_ADDRESS,
            _collateral.wmul(_tab).wdiv(_tab + rap),
            daiToken,
            _tab,
            _minEthDaiConversionRate
        );
            
        // Convert the remaining portion of removedCollateral into MKR
        if(rap > 0) {
            // Compute MKR fee to pay when repaying _convertedDai DAI
            uint256 mkrFee = _convertedDai.rmul(rap.rdiv(_tab)).wdiv(daiPerMkr());
            // Convert the remaining portion of _collateral into MKR
            _convertedMkr = tokenExchanger.trade(    
                _wallet,
                ETH_TOKEN_ADDRESS,
                _collateral.wmul(rap).wdiv(_tab + rap),
                mkrToken,
                mkrFee,
                _minEthMkrConversionRate
            );

            // If Kyber was stingy with MKR, convert fewer DAI
            if(_convertedMkr < mkrFee) {
                _convertedDai = _convertedMkr.rmul(_tab.rdiv(rap)).wmul(daiPerMkr());
            }
        }
    }
}