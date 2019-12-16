pragma solidity ^0.5.4;

import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../../lib/utils/SafeMath.sol";
import "../infrastructure/MakerRegistry.sol";

contract GemLike {
    function balanceOf(address) public view returns (uint);
    function transferFrom(address, address, uint) public returns (bool);
    function approve(address, uint) public returns (bool success);
}

contract VatLike {
    struct Ilk {
        uint256 Art;   // Total Normalised Debt     [wad]
        uint256 rate;  // Accumulated Rates         [ray]
        uint256 spot;  // Price with Safety Margin  [ray]
        uint256 line;  // Debt Ceiling              [rad]
        uint256 dust;  // Urn Debt Floor            [rad]
    }
    struct Urn {
        uint256 ink;   // Locked Collateral  [wad]
        uint256 art;   // Normalised Debt    [wad]
    }
    mapping (bytes32 => Ilk) public ilks;
    mapping (bytes32 => mapping (address => Urn )) public urns;
    function can(address, address) public view returns (uint);
    function dai(address) public view returns (uint);
    function hope(address) public;
}

contract JoinLike {
    function ilk() public view returns (bytes32);
    function gem() public view returns (GemLike);
    function dai() public view returns (GemLike);
    function join(address, uint) public;
    function exit(address, uint) public;
    VatLike public vat;
    uint    public live;
}

contract ManagerLike {
    function urns(uint) public view returns (address);
    function open(bytes32, address) public returns (uint);
    function frob(uint, int, int) public;
    function give(uint, address) public;
    function move(uint, address, uint) public;
    function flux(uint, address, uint) public;
    mapping (uint => bytes32) public ilks;
    mapping (uint => address) public owns;
}

contract ScdMcdMigration {
    function swapSaiToDai(uint wad) external;
    function swapDaiToSai(uint wad) external;
    function migrate(bytes32 cup) external returns (uint cdp);
    JoinLike public saiJoin;
    JoinLike public wethJoin;
    JoinLike public daiJoin;
    ManagerLike public cdpManager;
    SaiTubLike public tub;
}

contract ValueLike {
    function peek() public returns (uint, bool);
}

contract SaiTubLike {
    function gov() public view returns (GemLike);
    function pep() public view returns (ValueLike);
    function rap(bytes32) public returns (uint);
    function give(bytes32, address) public;
}

/**
 * @title MakerV2Base
 * @dev Module to convert SAI <-> DAI. Also serves as common base to MakerV2Invest and MakerV2Loan.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract MakerV2Base is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant private NAME = "MakerV2Manager";

    // The address of the SAI token
    GemLike internal saiToken;
    // The address of the (MCD) DAI token
    GemLike internal daiToken;
    // The address of the SAI <-> DAI migration contract
    address internal scdMcdMigration;
    // The address of the Dai Adapter
    JoinLike internal daiJoin;
    // The address of the Vat
    VatLike internal vat;

    // Method signatures to reduce gas cost at depoyment
    bytes4 constant internal ERC20_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 constant internal SWAP_SAI_DAI = bytes4(keccak256("swapSaiToDai(uint256)"));
    bytes4 constant internal SWAP_DAI_SAI = bytes4(keccak256("swapDaiToSai(uint256)"));

    uint256 constant internal RAY = 10 ** 27;

    using SafeMath for uint256;

    // ****************** Events *************************** //

    event TokenConverted(address indexed _wallet, address _srcToken, uint _srcAmount, address _destToken, uint _destAmount);

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        ScdMcdMigration _scdMcdMigration
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        scdMcdMigration = address(_scdMcdMigration);
        daiJoin = _scdMcdMigration.daiJoin();
        saiToken = _scdMcdMigration.saiJoin().gem();
        daiToken = daiJoin.dai();
        vat = daiJoin.vat();
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

}