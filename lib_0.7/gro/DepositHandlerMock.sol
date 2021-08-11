pragma solidity >=0.6.0 <0.8.0;

contract DepositHandlerMock {

    function referral(address referee) external view returns (address) {}
    
    function depositGvt(
        uint256[3] calldata inAmounts,
        uint256 minAmount,
        address referral
    ) external {}

    function depositPwrd(
        uint256[3] calldata inAmounts,
        uint256 minAmount,
        address referral
    ) external {}
}