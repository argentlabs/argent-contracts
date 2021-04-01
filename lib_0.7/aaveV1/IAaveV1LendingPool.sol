pragma solidity ^0.7.5;

/**
* @title LendingPool contract as in https://etherscan.io/address/0x017788dded30fdd859d295b90d4e41a19393f423#code
* @notice Implements the actions of the LendingPool, and exposes accessory methods to fetch the users and reserve data
* @author Aave
 **/
abstract contract IAaveV1LendingPool {
    /**
    * @dev emitted on deposit
    * @param _reserve the address of the reserve
    * @param _user the address of the user
    * @param _amount the amount to be deposited
    * @param _referral the referral number of the action
    * @param _timestamp the timestamp of the action
    **/
    event Deposit(
        address indexed _reserve,
        address indexed _user,
        uint256 _amount,
        uint16 indexed _referral,
        uint256 _timestamp
    );

    /**
    * @dev deposits The underlying asset into the reserve. A corresponding amount of the overlying asset (aTokens)
    * is minted.
    * @param _reserve the address of the reserve
    * @param _amount the amount to be deposited
    * @param _referralCode integrators are assigned a referral code and can potentially receive rewards.
    **/
    function deposit(address _reserve, uint256 _amount, uint16 _referralCode) external payable virtual;

    // Forbidden function
    function borrow(
        address _reserve,
        uint256 _amount,
        uint256 _interestRateMode,
        uint16 _referralCode
    ) external virtual;
}