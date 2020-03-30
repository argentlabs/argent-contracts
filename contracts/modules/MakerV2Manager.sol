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
import "../../lib/utils/SafeMath.sol";
import "../defi/Invest.sol";

contract VatLike {
    function can(address, address) public view returns (uint);
    function dai(address) public view returns (uint);
    function hope(address) public;
}

contract JoinLike {
    function gem() public returns (GemLike);
    function dai() public returns (GemLike);
    function join(address, uint) public;
    function exit(address, uint) public;
    VatLike public vat;
}

contract PotLike {
    function chi() public view returns (uint);
    function pie(address) public view returns (uint);
    function drip() public;
}

contract ScdMcdMigration {
    function swapSaiToDai(uint wad) external;
    function swapDaiToSai(uint wad) external;
    JoinLike public saiJoin;
    JoinLike public wethJoin;
    JoinLike public daiJoin;
}

contract GemLike {
    function balanceOf(address) public view returns (uint);
    function transferFrom(address, address, uint) public returns (bool);
}

/**
 * @title MakerV2Manager
 * @dev Module to convert SAI <-> DAI and lock/unlock MCD DAI into/from Maker's Pot,
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract MakerV2Manager is Invest, BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "MakerV2Manager";

    // The address of the SAI token
    GemLike public saiToken;
    // The address of the (MCD) DAI token
    GemLike public daiToken;
    // The address of the SAI <-> DAI migration contract
    address public scdMcdMigration;
    // The address of the Pot
    PotLike public pot;
    // The address of the Dai Adapter
    JoinLike public daiJoin;
    // The address of the Vat
    VatLike public vat;

    // Method signatures to reduce gas cost at depoyment
    bytes4 constant internal ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));
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
        PotLike _pot
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        scdMcdMigration = address(_scdMcdMigration);
        saiToken = _scdMcdMigration.saiJoin().gem();
        daiJoin = _scdMcdMigration.daiJoin();
        vat = daiJoin.vat();
        daiToken = daiJoin.dai();
        pot = _pot;
    }

    // *************** External/Public Functions ********************* //

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
        require(_token == address(daiToken), "DM: token should be DAI");
        require(_fraction <= 10000, "DM: invalid fraction value");
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
        require(saiToken.balanceOf(address(_wallet)) >= _amount, "DM: insufficient SAI");
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
        require(daiToken.balanceOf(address(_wallet)) >= _amount, "DM: insufficient DAI");
        invokeWallet(address(_wallet), address(daiToken), 0, abi.encodeWithSelector(ERC20_APPROVE, scdMcdMigration, _amount));
        invokeWallet(address(_wallet), scdMcdMigration, 0, abi.encodeWithSelector(SWAP_DAI_SAI, _amount));
        emit TokenConverted(address(_wallet), address(daiToken), _amount, address(saiToken), _amount);
    }
}