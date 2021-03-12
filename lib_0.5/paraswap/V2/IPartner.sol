pragma solidity ^0.5.4;


interface IPartner {

    function getReferralId() external view returns(string memory);

    function getFeeWallet() external view returns(address payable);

    function getFee() external view returns(uint256);

    function getPartnerShare() external returns(uint256);

    function getParaswapShare() external returns(uint256);

    function changeFeeWallet(address payable feeWallet) external;

    function changeFee(uint256 newFee) external;
}