pragma solidity ^0.7.5;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title Aave ERC20 AToken
 *
 * @dev Implementation of the interest bearing token for the DLP protocol.
 * https://etherscan.io/address/0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04#code
 * @author Aave
 */
 abstract contract IAToken is IERC20 {
    /**
    * @dev emitted after the redeem action
    * @param _from the address performing the redeem
    * @param _value the amount to be redeemed
    * @param _fromBalanceIncrease the cumulated balance since the last update of the user
    * @param _fromIndex the last index of the user
    **/
    event Redeem(
        address indexed _from,
        uint256 _value,
        uint256 _fromBalanceIncrease,
        uint256 _fromIndex
    );

    /**
    * @dev redeems aToken for the underlying asset
    * @param _amount the amount being redeemed
    **/
    function redeem(uint256 _amount) external virtual;
}