pragma solidity ^0.6.12;

import "../contracts/infrastructure/dapp/IFilter.sol";

contract TestFilter is IFilter {
    function validate(address _wallet, address _spender, address _to, bytes calldata _data) external override view returns (bool) {
        (bytes32 tmp, uint256 state) = abi.decode(abi.encodePacked(bytes28(0),_data), (bytes32, uint256));
        return state != 5;
    }
}