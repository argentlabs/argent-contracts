pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";



interface IKarma {

   /**
   * @dev The function performs on chain tx building and swapping
   * @param fromToken Address of the source token
   * @param destToken Address of the destination token
   * @param fromAmount Amount of source tokens to be swapped
   * @param minDestAmount Minimum destination token amount expected out of this swap
   * @param beneficiary Beneficiary address
   * @param distributions Distribution of fromToken to each supported exchange in basis points
   * @param referrer referral id
   * @return returnAmount the total amount of destination tokens received
   */
    function swap(
        IERC20 fromToken,
        IERC20 destToken,
        uint256 fromAmount,
        uint256 minDestAmount,
        address payable beneficiary,
        uint256[] calldata distributions,
        string calldata referrer
    )
        external
        payable
        returns(uint256 returnAmount);

   /**
   * @dev The function performs on chain tx building and swapping
   * @param tokens Path to be followed to swap token at index 0 with token at last index
   * @param fromAmount Amount of source tokens to be swapped
   * @param minDestAmount Minimum destination token amount expected out of this swap
   * @param beneficiary Beneficiary address
   * @param distributions Distribution of tokens to each supported exchange in basis points
   * @param referrer referral id
   * @return returnAmount the total amount of destination tokens received
   */
    function multiSwap(
        IERC20[] calldata tokens,
        uint256 fromAmount,
        uint256 minDestAmount,
        address payable beneficiary,
        uint256[][] calldata distributions,
        string calldata referrer
    )
        external
        payable
        returns(uint256 returnAmount);
}
