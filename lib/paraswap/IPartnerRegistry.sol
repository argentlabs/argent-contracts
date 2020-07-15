pragma solidity ^0.5.4;


interface IPartnerRegistry {

    function getPartnerContract(string calldata referralId) external view returns(address);

    function addPartner(
        string calldata referralId,
        address feeWallet,
        uint256 fee,
        uint256 paraswapShare,
        uint256 partnerShare,
        address owner
    )
        external;

    function removePartner(string calldata referralId) external;
}