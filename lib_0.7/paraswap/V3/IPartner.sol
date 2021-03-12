pragma solidity 0.7.5;


interface IPartner {

    function getReferralId() external view returns(string memory);

    function getFeeWallet() external view returns(address payable);

    function getFee() external view returns(uint256);

    function getPartnerShare() external view returns(uint256);

    function getParaswapShare() external view returns(uint256);

    function changeFeeWallet(address payable feeWallet) external;

    function changeFee(uint256 newFee) external;

    function getPositiveSlippageToUser() external view returns(bool);

    function changePositiveSlippageToUser(bool slippageToUser) external;

    function getPartnerInfo() external view returns(
        address payable feeWallet,
        uint256 fee,
        uint256 partnerShare,
        uint256 paraswapShare,
        bool positiveSlippageToUser
    );
}
