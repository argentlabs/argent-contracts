pragma solidity ^0.5.4;

import "./MakerInterfaces.sol";

contract MockVat is VatLike {
    function can(address, address) public view returns (uint) { return 1; }
    function dai(address) public view returns (uint) { return 0; }
    function hope(address) public {}
    function wards(address) public view returns (uint) { return 1; }
    function ilks(bytes32) public view returns (uint, uint, uint, uint, uint) { return (0, 0, 0, 0, 0); }
    function urns(bytes32, address) public view returns (uint, uint) { return (0, 0); }
    function frob(bytes32, address, address, address, int, int) public {}
    function slip(bytes32,address,int) public {}
    function move(address,address,uint) public {}
    function fold(bytes32,address,int) public {}
    function suck(address,address,uint256) public {}
    function flux(bytes32, address, address, uint) public {}
    function fork(bytes32, address, address, int, int) public {}
}

contract MockTub is SaiTubLike {
    function gov() public view returns (GemLike) { return GemLike(address(0)); }
    function skr() public view returns (GemLike) { return GemLike(address(0)); }
    function gem() public view returns (GemLike) { return GemLike(address(0)); }
    function sai() public view returns (GemLike) { return GemLike(address(0)); }
    function pep() public view returns (ValueLike) { return ValueLike(address(0)); }
    function rap(bytes32) public returns (uint) { return 0; }
    function give(bytes32, address) public {}
    function tab(bytes32) public returns (uint) { return 0; }
    function bid(uint) public view returns (uint) { return 0; }
    function ink(bytes32) public view returns (uint) { return 0; }
    function shut(bytes32) public {}
    function exit(uint) public {}
}

contract MockJoin is JoinLike {
    MockVat public vat;
    uint public live;
    constructor (MockVat _vat) public { vat = _vat; }
    function ilk() public view returns (bytes32) { return bytes32(0); }
    function gem() public view returns (GemLike) { return GemLike(address(0)); }
    function dai() public view returns (GemLike) { return GemLike(address(0)); }
    function join(address, uint) public {}
    function exit(address, uint) public {}
}

/**
 * @title MockScdMcdMigration
 * @dev Mock contract needed to deploy the MakerV2Manager contract
 */
contract MockScdMcdMigration {

    MockJoin public daiJoin;
    MockJoin public wethJoin;
    MockTub public tub;
    ManagerLike public cdpManager;
    MockVat public vat;

    constructor (address _vat, address _daiJoin, address _wethJoin, address _tub, address _cdpManager) public {
        vat = (_vat != address(0)) ? MockVat(_vat) : new MockVat();
        daiJoin = (_daiJoin != address(0)) ? MockJoin(_daiJoin) : new MockJoin(vat);
        wethJoin = (_wethJoin != address(0)) ? MockJoin(_wethJoin) : new MockJoin(vat);
        tub = (_tub != address(0)) ? MockTub(_tub) : new MockTub();
        if (_cdpManager != address(0)) {
            cdpManager = ManagerLike(_cdpManager);
        }
    }
}