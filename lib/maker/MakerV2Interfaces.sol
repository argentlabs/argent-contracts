pragma solidity ^0.5.4;

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
