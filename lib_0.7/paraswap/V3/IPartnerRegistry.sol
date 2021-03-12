pragma solidity 0.7.5;


interface IPartnerRegistry {

    function getPartnerContract(string calldata referralId) external view returns(address);

    function addPartner(
        string calldata referralId,
        address payable feeWallet,
        uint256 fee,
        uint256 paraswapShare,
        uint256 partnerShare,
        address owner,
        uint256 timelock,
        uint256 maxFee,
        bool positiveSlippageToUser
    )
        external;

    function removePartner(string calldata referralId) external;
}
