pragma solidity 0.7.5;

contract CurvePoolMock {
  function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 minDy) external {}
  function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external payable {}
}