pragma solidity 0.7.5;

import "./ITokenTransferProxy.sol";


contract AdapterStorage {

    mapping (bytes32 => bool) internal adapterInitialized;
    mapping (bytes32 => bytes) internal adapterVsData;
    ITokenTransferProxy internal _tokenTransferProxy;

    function isInitialized(bytes32 key) public view returns(bool) {
        return adapterInitialized[key];
    }

    function getData(bytes32 key) public view returns(bytes memory) {
        return adapterVsData[key];
    }

    function getTokenTransferProxy() public view returns (address) {
        return address(_tokenTransferProxy);
    }
}
