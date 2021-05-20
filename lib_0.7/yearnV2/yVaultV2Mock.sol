pragma solidity ^0.7.5;

contract yVaultV2Mock {
    function setManagementFee(uint256) external {}
    function deposit() external {}
    function deposit(uint256 _amount) external returns (uint256) {}
    function deposit(uint256 _amount, address _recipient) external returns (uint256) {}
    function withdraw() external returns (uint256) {}
    function withdraw(uint256 _maxShares) external returns (uint256) {}
    function withdraw(uint256 _maxShares, address _recipient) external returns (uint256) {}
    function withdraw(uint256 _maxShares, address _recipient, uint _maxLoss) external returns (uint256){}
}