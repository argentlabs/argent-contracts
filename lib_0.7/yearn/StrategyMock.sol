// SPDX-License-Identifier: MIT

pragma solidity ^0.7.5;

import "./interfaces/IStrategy.sol";

contract StrategyMock is IStrategy {
    function want() external override view returns (address) {}

    function deposit() external override {}

    // NOTE: must exclude any tokens used in the yield
    // Controller role - withdraw should return to Controller
    function withdraw(address) external override{}

    // Controller | Vault role - withdraw should always return to Vault
    function withdraw(uint256) override external {}

    function skim() external override {}

    // Controller | Vault role - withdraw should always return to Vault
    function withdrawAll() external override returns (uint256) {}

    function balanceOf() external override view returns (uint256) {}

    function withdrawalFee() external override view returns (uint256) {}
}