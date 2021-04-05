// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.5.4 <0.9.0;

contract TestDapp {
    function noReturn() external {}
    function uintReturn(uint256 _i) external pure returns (uint256) { return _i; }
    function doFail(string calldata reason) external pure { revert(reason); }
}