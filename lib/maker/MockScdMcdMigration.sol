pragma solidity ^0.5.4;

import "./MakerV2Interfaces.sol";

contract MockVat {
    function hope(address) external {}
}

contract MockTub is SaiTubLike {
    function gov() public view returns (GemLike) { return GemLike(address(0)); }
    function skr() public view returns (GemLike) { return GemLike(address(0)); }
    function gem() public view returns (GemLike) { return GemLike(address(0)); }
    function sai() public view returns (GemLike) { return GemLike(address(0)); }
    function pep() public view returns (ValueLike) { return ValueLike(address(0)); }
    function rap(bytes32) public returns (uint) { return 0; }
    function give(bytes32, address) public {}
    function tab(bytes32) public returns (uint) {}
    function bid(uint) public view returns (uint) {}
    function ink(bytes32) public view returns (uint) {}
    function shut(bytes32) public {}
    function exit(uint) public {}
}

contract MockJoin is JoinLike {
    constructor () public { vat = new MockVat(); }
    function ilk() public view returns (bytes32) { return bytes32(0); }
    function gem() public view returns (GemLike) { return GemLike(address(0)); }
    function dai() public view returns (GemLike) { return GemLike(address(0)); }
    function join(address, uint) public {}
    function exit(address, uint) public {}
    MockVat public vat;
}

/**
 * @title MockScdMcdMigration
 * @dev Mock contract needed to deploy the MakerV2Manager contract
 */
contract MockScdMcdMigration {

    MockJoin public saiJoin;
    MockJoin public daiJoin;
    MockJoin public wethJoin;
    MockTub public tub;
    ManagerLike public cdpManager;

    constructor (address _daiJoin, address _wethJoin, address _tub, address _cdpManager) public {
        daiJoin = (_daiJoin != address(0)) ? MockJoin(_daiJoin) : new MockJoin();
        wethJoin = (_wethJoin != address(0)) ? MockJoin(_wethJoin) : new MockJoin();
        tub = (_tub != address(0)) ? MockTub(_tub) : new MockTub();
        if (_cdpManager != address(0)) {
            cdpManager = ManagerLike(_cdpManager);
        }
        saiJoin = new MockJoin();
    }
}