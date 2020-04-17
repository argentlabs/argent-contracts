pragma solidity ^0.5.4;

contract GemLike {
    function balanceOf(address) public view returns (uint);
    function transferFrom(address, address, uint) public returns (bool);
    function approve(address, uint) public returns (bool success);
    function decimals() public view returns (uint);
    function transfer(address,uint) external returns (bool);
}

contract DSTokenLike {
    function mint(address,uint) external;
    function burn(address,uint) external;
}

contract VatLike {
    function can(address, address) public view returns (uint);
    function dai(address) public view returns (uint);
    function hope(address) public;
    function ilks(bytes32) public view returns (uint Art, uint rate, uint spot, uint line, uint dust);
    function urns(bytes32, address) public view returns (uint ink, uint art);
    function frob(bytes32, address, address, address, int, int) public;
    function slip(bytes32,address,int) external;
    function move(address,address,uint) external;
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
    function vat() public view returns (address);
    function urns(uint) public view returns (address);
    function open(bytes32, address) public returns (uint);
    function frob(uint, int, int) public;
    function give(uint, address) public;
    function move(uint, address, uint) public;
    function flux(uint, address, uint) public;
    mapping (uint => bytes32) public ilks;
    mapping (uint => address) public owns;
}

contract ScdMcdMigrationLike {
    function swapSaiToDai(uint) public;
    function swapDaiToSai(uint) public;
    function migrate(bytes32) public returns (uint);
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
    function skr() public view returns (GemLike);
    function gem() public view returns (GemLike);
    function gov() public view returns (GemLike);
    function sai() public view returns (GemLike);
    function pep() public view returns (ValueLike);
    function bid(uint) public view returns (uint);
    function ink(bytes32) public view returns (uint);
    function tab(bytes32) public returns (uint);
    function rap(bytes32) public returns (uint);
    function shut(bytes32) public;
    function exit(uint) public;
}

contract VoxLike {
    function par() public returns (uint);
}

contract JugLike {
    function drip(bytes32) external;
}
