pragma solidity 0.7.5;

contract CurvePoolMock {
  function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 minDy) external {}
  function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external payable {}
  function add_liquidity(uint256[2] calldata, uint256) external payable {}
  function add_liquidity(uint256[3] calldata, uint256) external payable {}
  function add_liquidity(uint256[4] calldata, uint256) external payable {}
  function remove_liquidity(uint256, uint256[2] calldata) external payable {}
  function remove_liquidity(uint256, uint256[3] calldata) external payable {}
  function remove_liquidity(uint256, uint256[4] calldata) external payable {}
  function get_virtual_price() external returns (uint256) {}
}