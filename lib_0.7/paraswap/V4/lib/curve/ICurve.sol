pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

interface IPool {
  function underlying_coins(int128 index) external view returns (address);

  function coins(int128 index) external view returns (address);
}

interface IPoolV3 {
    function underlying_coins(uint256 index) external view returns(address);

    function coins(uint256 index) external view returns(address);
}

interface ICurvePool {
  function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 minDy) external;

  function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external;

}

interface ICurveEthPool {

  function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external payable;
}

interface ICompoundPool {
  function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 minDy, uint256 deadline) external;

  function exchange(int128 i, int128 j, uint256 dx, uint256 minDy, uint256 deadline) external;
}
