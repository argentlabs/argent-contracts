pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/access/Ownable.sol";

import "./IWhitelisted.sol";
import "./lib/IExchange.sol";
import "./lib/Utils.sol";
import "./KarmaTokenTransferProxy.sol";


contract Karma is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    KarmaTokenTransferProxy private _tokenTransferProxy;

    bool private _paused;

    string private _version = "1.0.0";

    event Paused();
    event Unpaused();

    address[] public exchanges;

    event Swapped(
        address initiator,
        address indexed beneficiary,
        address indexed srcToken,
        address indexed destToken,
        uint256 srcAmount,
        uint256 receivedAmount,
        uint256 expectedAmount,
        string referrer
    );

    event ExchangeAdded(address indexed exchange, uint256 index);

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     */
    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     */
    modifier whenPaused() {
        require(_paused, "Pausable: not paused");
        _;
    }

    constructor()
        public
    {
        _tokenTransferProxy = new KarmaTokenTransferProxy();
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    */
    receive() external payable {
    }

    function getVersion() external view returns(string memory) {
        return _version;
    }

    function getTokenTransferProxy() external view returns (address) {
        return address(_tokenTransferProxy);
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() external view returns (bool) {
        return _paused;
    }

    /**
     * @dev Called by a pauser to pause, triggers stopped state.
     */
    function pause() external onlyOwner whenNotPaused {
        _paused = true;
        emit Paused();
    }

    /**
     * @dev Called by a pauser to unpause, returns to normal state.
     */
    function unpause() external onlyOwner whenPaused {
        _paused = false;
        emit Unpaused();
    }

    function addExchange(address exchange) external onlyOwner {
        exchanges.push(exchange);
        emit ExchangeAdded(exchange, exchanges.length - 1);
    }

  /**
   * @dev The function performs on chain tx building and swapping
   * @param tokens Path to be followed to swap token at index 0 with token at last index
   * @param fromAmount Amount of source tokens to be swapped
   * @param minDestAmount Minimum destination token amount expected out of this swap
   * @param beneficiary Beneficiary address
   * @param distributions Distribution of tokens to each supported exchange in basis points
   * @param referrer referral id
   * @return Returns the total amount of destination tokens received
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
        returns(uint256)
    {
        require(
            tokens.length - 1 == distributions.length,
            "Number of distribution should be one less than total tokens in path"
        );

        if (address(tokens[0]) != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                address(tokens[0]),
                msg.sender,
                address(this),
                fromAmount
            );
        }

        uint receivedAmount = fromAmount;
        for (uint256 i = 0; i < tokens.length - 1; i++) {
            IERC20 fromToken = tokens[i];
            IERC20 toToken = tokens[i + 1];

            receivedAmount = _swap(
                fromToken,
                toToken,
                receivedAmount,
                distributions[i]
            );
        }

        require(
            receivedAmount >= minDestAmount,
            "Received amount of tokens are less then expected"
        );

        Utils.transferTokens(
            address(tokens[tokens.length - 1]),
            beneficiary == address(0) ? msg.sender : beneficiary,
            receivedAmount
        );

        emit Swapped(
            msg.sender,
            beneficiary == address(0)?msg.sender:beneficiary,
            address(tokens[0]),
            address(tokens[tokens.length - 1]),
            fromAmount,
            receivedAmount,
            minDestAmount,
            referrer
        );

        return receivedAmount;

    }

  /**
   * @dev The function performs on chain tx building and swapping
   * @param fromToken Address of the source token
   * @param destToken Address of the destination token
   * @param fromAmount Amount of source tokens to be swapped
   * @param minDestAmount Minimum destination token amount expected out of this swap
   * @param beneficiary Beneficiary address
   * @param distributions Distribution of fromToken to each supported exchange in basis points
   */
    function swap(
        IERC20 fromToken,
        IERC20 destToken,
        uint256 fromAmount,
        uint256 minDestAmount,
        address payable beneficiary,
        uint256[] memory distributions,
        string calldata referrer
    )
        external
        payable
        returns(uint256)
    {
        require(
            distributions.length <= exchanges.length,
            "Distributions exceeding number of exchanges"
        );

        if (address(fromToken) != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                address(fromToken),
                msg.sender,
                address(this),
                fromAmount
            );
        }

        uint256 receivedAmount = _swap(
            fromToken,
            destToken,
            fromAmount,
            distributions
        );
        require(
            receivedAmount >= minDestAmount,
            "Received amount of tokens are less then expected"
        );

        Utils.transferTokens(
            address(destToken),
            beneficiary == address(0) ? msg.sender : beneficiary,
            receivedAmount
        );

        emit Swapped(
            msg.sender,
            beneficiary == address(0)?msg.sender:beneficiary,
            address(fromToken),
            address(destToken),
            fromAmount,
            receivedAmount,
            minDestAmount,
            referrer
        );

        return receivedAmount;
    }

    function _swap(
        IERC20 fromToken,
        IERC20 destToken,
        uint256 fromAmount,
        uint256[] memory distributions
    )
        private
        returns(uint256)
    {
        uint256 totalPercent = 0;
        for (uint256 i = 0; i < distributions.length; i++) {

            if(distributions[i] == 0) {
                continue;
            }

            totalPercent = totalPercent + distributions[i];

            uint256 _fromAmount = fromAmount.mul(distributions[i]).div(10000);
            if (totalPercent == 10000) {
                _fromAmount = Utils.tokenBalance(address(fromToken), address(this));
            }

            if (address(fromToken) != Utils.ethAddress()) {
                  fromToken.safeTransfer(exchanges[i], _fromAmount);
                  IExchange(exchanges[i]).onChainSwap{
                      value: 0
                  }(fromToken, destToken, _fromAmount, 1);
            }

            else {
                IExchange(exchanges[i]).onChainSwap{
                    value: _fromAmount
                }(fromToken, destToken, _fromAmount, 1);
            }

        }

        require(
                totalPercent == 10000,
                "Total distribution basis points should be equal to 10000"
        );

        uint256 receivedAmount = Utils.tokenBalance(
            address(destToken),
            address(this)
        );

        return receivedAmount;
    }

}
