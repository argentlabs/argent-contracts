pragma solidity 0.7.5;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


/**
* @dev This interface should be implemented by all exchanges which needs to integrate with the paraswap protocol
*/
interface IExchange {

    /**
   * @dev The function which performs the swap on an exchange.
   * Exchange needs to implement this method in order to support swapping of tokens through it
   * @param fromToken Address of the source token
   * @param toToken Address of the destination token
   * @param fromAmount Amount of source tokens to be swapped
   * @param toAmount Minimum destination token amount expected out of this swap
   * @param exchange Internal exchange or factory contract address for the exchange. For example Registry address for the Uniswap
   * @param payload Any exchange specific data which is required can be passed in this argument in encoded format which
   * will be decoded by the exchange. Each exchange will publish it's own decoding/encoding mechanism
   */
   //TODO: REMOVE RETURN STATEMENT
    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload) external payable;

  /**
   * @dev The function which performs the swap on an exchange.
   * Exchange needs to implement this method in order to support swapping of tokens through it
   * @param fromToken Address of the source token
   * @param toToken Address of the destination token
   * @param fromAmount Max Amount of source tokens to be swapped
   * @param toAmount Destination token amount expected out of this swap
   * @param exchange Internal exchange or factory contract address for the exchange. For example Registry address for the Uniswap
   * @param payload Any exchange specific data which is required can be passed in this argument in encoded format which
   * will be decoded by the exchange. Each exchange will publish it's own decoding/encoding mechanism
   */
    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address exchange,
        bytes calldata payload) external payable;

    /**
   * @dev This function is used to perform onChainSwap. It build all the parameters onchain. Basically the information
   * encoded in payload param of swap will calculated in this case
   * Exchange needs to implement this method in order to support swapping of tokens through it
   * @param fromToken Address of the source token
   * @param toToken Address of the destination token
   * @param fromAmount Amount of source tokens to be swapped
   * @param toAmount Minimum destination token amount expected out of this swap
   */
    function onChainSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount
    ) external payable returns (uint256);

    /**
    * @dev Certain adapters/exchanges needs to be initialized.
    * This method will be called from Augustus
    */
    function initialize(bytes calldata data) external;

    /**
    * @dev Returns unique identifier for the adapter
    */
    function getKey() external view returns(bytes32);
}

