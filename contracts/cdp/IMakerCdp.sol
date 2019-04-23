pragma solidity ^0.5.4;

// Interface to MakerDAO's Tub contract, used to manage CDPs
contract IMakerCdp {
    IDSValue  public pep; // MKR price feed
    IMakerVox public vox; // DAI price feed

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