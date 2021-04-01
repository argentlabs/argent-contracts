pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "./IPartner.sol";


contract Partner is Ownable, IPartner {
    using SafeMath for uint256;

    enum ChangeType { _, FEE, WALLET, SLIPPAGE }

    struct ChangeRequest {
        uint256 fee;
        address payable wallet;
        bool slippageToUser;
        bool completed;
        uint256 requestedBlockNumber;
    }

    mapping(uint256 => ChangeRequest) private _typeVsChangeRequest;

    string private _referralId;

    address payable private _feeWallet;

    //It should be in basis points. For 1% it should be 100
    uint256 private _fee;

    //Paraswap share in the fee. For 20% it should 2000
    //It means 20% of 1% fee charged
    uint256 private _paraswapShare;

    //Partner share in the fee. For 80% it should be 8000
    uint256 private _partnerShare;

    //Number of blocks after which change request can be fulfilled
    uint256 private _timelock;

    uint256 private _maxFee;

    //Whether positive slippage will go to user
    bool private _positiveSlippageToUser;

    bool private _noPositiveSlippage;

    event FeeWalletChanged(address indexed feeWallet);
    event FeeChanged(uint256 fee);

    event ChangeRequested(
        ChangeType changeType,
        uint256 fee,
        address wallet,
        bool positiveSlippageToUser,
        uint256 requestedBlockNumber
    );
    event ChangeRequestCancelled(
        ChangeType changeType,
        uint256 fee,
        address wallet,
        bool positiveSlippageToUser,
        uint256 requestedBlockNumber
    );
    event ChangeRequestFulfilled(
        ChangeType changeType,
        uint256 fee,
        address wallet,
        bool positiveSlippageToUser,
        uint256 requestedBlockNumber,
        uint256 fulfilledBlockNumber
    );

    constructor(
        string memory referralId,
        address payable feeWallet,
        uint256 fee,
        uint256 paraswapShare,
        uint256 partnerShare,
        address owner,
        uint256 timelock,
        uint256 maxFee,
        bool noPositiveSlippage,
        bool positiveSlippageToUser
    )
        public
    {
        _referralId = referralId;
        _feeWallet = feeWallet;
        _fee = fee;
        _paraswapShare = paraswapShare;
        _partnerShare = partnerShare;
        _timelock = timelock;
        _maxFee = maxFee;
        _positiveSlippageToUser = positiveSlippageToUser;
        _noPositiveSlippage = noPositiveSlippage;

        transferOwnership(owner);
    }

    function getReferralId() external view returns(string memory) {
        return _referralId;
    }

    function getFeeWallet() external view returns(address payable) {
        return _feeWallet;
    }

    function getFee() external view returns(uint256) {
        return _fee;
    }

    function getPartnerShare() external view returns(uint256) {
        return _partnerShare;
    }

    function getParaswapShare() external view returns(uint256) {
        return _paraswapShare;
    }

    function getTimeLock() external view returns(uint256) {
        return _timelock;
    }

    function getMaxFee() external view returns(uint256) {
        return _maxFee;
    }

    function getNoPositiveSlippage() external view returns(bool) {
        return _noPositiveSlippage;
    }

    function getPositiveSlippageToUser() external view returns(bool) {
        return _positiveSlippageToUser;
    }

    function getPartnerInfo() external override view returns(
        address payable feeWallet,
        uint256 fee,
        uint256 partnerShare,
        uint256 paraswapShare,
        bool positiveSlippageToUser,
        bool noPositiveSlippage
    )
    {
        return(
            _feeWallet,
            _fee,
            _partnerShare,
            _paraswapShare,
            _positiveSlippageToUser,
            _noPositiveSlippage
        );
    }

    function getChangeRequest(
        ChangeType changeType
    )
        external
        view
        returns(
            uint256,
            address,
            bool,
            uint256
        )
    {
        ChangeRequest memory changeRequest = _typeVsChangeRequest[uint256(changeType)];

        return(
            changeRequest.fee,
            changeRequest.wallet,
            changeRequest.completed,
            changeRequest.requestedBlockNumber
        );
    }

    function changeFeeRequest(uint256 fee) external onlyOwner {
        require(fee <= _maxFee, "Invalid fee passed!!");
        ChangeRequest storage changeRequest = _typeVsChangeRequest[uint256(ChangeType.FEE)];
        require(
            changeRequest.requestedBlockNumber == 0 || changeRequest.completed,
            "Previous fee change request pending"
        );

        changeRequest.fee = fee;
        changeRequest.requestedBlockNumber = block.number;
        changeRequest.completed = false;
        emit ChangeRequested(
            ChangeType.FEE,
            fee,
            address(0),
            false,
            block.number
        );
    }

    function changeWalletRequest(address payable wallet) external onlyOwner {
        require(wallet != address(0), "Invalid fee wallet passed!!");
        ChangeRequest storage changeRequest = _typeVsChangeRequest[uint256(ChangeType.WALLET)];

        require(
            changeRequest.requestedBlockNumber == 0 || changeRequest.completed,
            "Previous fee change request pending"
        );

        changeRequest.wallet = wallet;
        changeRequest.requestedBlockNumber = block.number;
        changeRequest.completed = false;
        emit ChangeRequested(
            ChangeType.WALLET,
            0,
            wallet,
            false,
            block.number
        );
    }

    function changePositiveSlippageToUser(bool slippageToUser) external onlyOwner {
        ChangeRequest storage changeRequest = _typeVsChangeRequest[uint256(ChangeType.SLIPPAGE)];

        require(
            changeRequest.requestedBlockNumber == 0 || changeRequest.completed,
            "Previous slippage change request pending"
        );

        changeRequest.slippageToUser = slippageToUser;
        changeRequest.requestedBlockNumber = block.number;
        changeRequest.completed = false;
        emit ChangeRequested(
            ChangeType.WALLET,
            0,
            address(0),
            slippageToUser,
            block.number
        );
    }

    function confirmChangeRequest(ChangeType changeType) external onlyOwner {
        ChangeRequest storage changeRequest = _typeVsChangeRequest[uint256(changeType)];

        require(
            changeRequest.requestedBlockNumber > 0 && !changeRequest.completed,
            "Invalid request"
        );

        require(
            changeRequest.requestedBlockNumber.add(_timelock) <= block.number,
            "Request is in waiting period"
        );

        changeRequest.completed = true;

        if(changeType == ChangeType.FEE) {
            _fee = changeRequest.fee;
        }

        else if(changeType == ChangeType.WALLET) {
            _feeWallet = changeRequest.wallet;
        }
        else {
            _positiveSlippageToUser = changeRequest.slippageToUser;
        }

        emit ChangeRequestFulfilled(
            changeType,
            changeRequest.fee,
            changeRequest.wallet,
            changeRequest.slippageToUser,
            changeRequest.requestedBlockNumber,
            block.number
        );
    }

    function cancelChangeRequest(ChangeType changeType) external onlyOwner {
        ChangeRequest storage changeRequest = _typeVsChangeRequest[uint256(changeType)];

        require(
            changeRequest.requestedBlockNumber > 0 && !changeRequest.completed,
            "Invalid request"
        );
        changeRequest.completed = true;

        emit ChangeRequestCancelled(
            changeType,
            changeRequest.fee,
            changeRequest.wallet,
            changeRequest.slippageToUser,
            changeRequest.requestedBlockNumber
        );

    }

}
