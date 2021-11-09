// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface INftFactory {
  function claimNft(address to) external returns (uint256);
  function nftToken() external returns (address);
}