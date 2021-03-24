pragma solidity 0.7.5;

import "./IPartnerDeployer.sol";
import "../Partner.sol";


contract PartnerDeployer is IPartnerDeployer {

    function deploy(
        string calldata referralId,
        address payable feeWallet,
        uint256 fee,
        uint256 paraswapShare,
        uint256 partnerShare,
        address owner,
        uint256 timelock,
        uint256 maxFee,
        bool positiveSlippageToUser,
        bool noPositiveSlippage
    )
        external
        override
        returns(address)
    {
        Partner partner = new Partner(
            referralId,
            feeWallet,
            fee,
            paraswapShare,
            partnerShare,
            owner,
            timelock,
            maxFee,
            positiveSlippageToUser,
            noPositiveSlippage
        );
        return address(partner);
    }
}
