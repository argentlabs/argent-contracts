pragma solidity 0.7.5;


interface IWhitelisted {

    function hasRole(
        bytes32 role,
        address account
    )
        external
        view
        returns (bool);

    function WHITELISTED_ROLE() external view returns(bytes32);
}
