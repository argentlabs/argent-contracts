pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./deployer/IPartnerDeployer.sol";


contract PartnerRegistry is Ownable {

    using SafeMath for uint256;

    mapping(bytes32 => address) private _referralVsPartner;

    IPartnerDeployer private _partnerDeployer;

    event PartnerAdded(string referralId, address indexed partnerContract);
    event PartnerRemoved(string referralId);
    event PartnerDeployerChanged(address indexed partnerDeployer);

    constructor(address partnerDeployer) public {
        _partnerDeployer = IPartnerDeployer(partnerDeployer);
    }

    function getPartnerDeployer() external view returns(address) {
        return address(_partnerDeployer);
    }

    function changePartnerDeployer(address partnerDeployer) external onlyOwner {
        require(partnerDeployer != address(0), "Invalid address");
        _partnerDeployer = IPartnerDeployer(partnerDeployer);
        emit PartnerDeployerChanged(partnerDeployer);
    }

    function getPartnerContract(string calldata referralId) external view returns(address) {

        return _referralVsPartner[keccak256(abi.encodePacked(referralId))];
    }

    function addPartner(
        string calldata referralId,
        address payable feeWallet,
        uint256 fee,
        uint256 paraswapShare,
        uint256 partnerShare,
        address owner,
        uint256 timelock,
        uint256 maxFee
    )
        external
        onlyOwner
    {
        require(feeWallet != address(0), "Invalid fee wallet");
        require(owner != address(0), "Invalid owner for partner");
        require(fee <= 10000, "Invalid fee passed");
        require(paraswapShare.add(partnerShare) == 10000, "Invalid shares");
        require(bytes(referralId).length > 0, "Empty refferalid");

        address partner = _partnerDeployer.deploy(
            referralId,
            feeWallet,
            fee,
            paraswapShare,
            partnerShare,
            owner,
            timelock,
            maxFee
        );

        _referralVsPartner[keccak256(abi.encodePacked(referralId))] = address(partner);

        emit PartnerAdded(referralId, partner);
    }

    function removePartner(string calldata referralId) external onlyOwner {
        _referralVsPartner[keccak256(abi.encodePacked(referralId))] = address(0);

        emit PartnerRemoved(referralId);
    }
}