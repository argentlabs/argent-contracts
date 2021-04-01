pragma solidity 0.7.5;


interface IPartnerRegistry {

    function getPartnerContract(string calldata referralId) external view returns(address);

}
