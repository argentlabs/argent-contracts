pragma solidity 0.7.5;


interface IPartner {

    function getPartnerInfo() external view returns(
        address payable feeWallet,
        uint256 fee,
        uint256 partnerShare,
        uint256 paraswapShare,
        bool positiveSlippageToUser,
        bool noPositiveSlippage
    );
}
