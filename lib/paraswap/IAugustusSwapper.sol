pragma solidity >=0.5.4 <0.7.0;

interface IAugustusSwapper {
    function getTokenTransferProxy() external view returns (address);
}