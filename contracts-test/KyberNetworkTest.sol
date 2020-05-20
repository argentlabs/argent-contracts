pragma solidity ^0.6.8;
import "../lib/other/ERC20.sol";
import "../lib/other/KyberNetwork.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract KyberNetworkTest is KyberNetwork {

    using SafeMath for uint256;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct Token {
        bool exists;
        uint256 rate;
        uint256 decimals;
    }

    mapping (address => Token) public tokens;
    address owner;

    constructor() public {
        owner = msg.sender;
    }

    function() external payable {}

    /**
    * @dev Adds a tradable token to the Kyber instance
    * @param _token The token
    * @param _rate The rate for the token as 1 TOKN = (rate/10**18) ETH
    * @param _decimals The number of decimals for the token
    */
    function addToken(ERC20 _token, uint256 _rate, uint256 _decimals) public {
        require(msg.sender == owner, "unauthorized");
        tokens[address(_token)] = Token({exists: true, rate: _rate, decimals: _decimals});
    }

    function getExpectedRate(
        ERC20 _src,
        ERC20 _dest,
        uint /* _srcQty */
    )
        public
        view
        returns (uint expectedRate, uint slippageRate)
    {
        if (address(_src) == ETH_TOKEN_ADDRESS) {
            expectedRate = 10**36 / tokens[address(_dest)].rate;
            slippageRate = expectedRate;
        } else if (address(_dest) == ETH_TOKEN_ADDRESS) {
            expectedRate = tokens[address(_src)].rate;
            slippageRate = expectedRate;
        } else {
            revert("Unknown token pair");
        }
    }

    function trade(
        ERC20 _src,
        uint _srcAmount,
        ERC20 _dest,
        address payable _destAddress,
        uint _maxDestAmount,
        uint /* _minConversionRate */,
        address /* _walletId */
    )
        public
        payable
        returns( uint destAmount)
    {
        uint expectedRate;
        uint srcAmount;
        if (address(_src) == ETH_TOKEN_ADDRESS) {
            expectedRate = 10**36 / tokens[address(_dest)].rate;
            destAmount = expectedRate.mul(_srcAmount).div(10**(36 - tokens[address(_dest)].decimals));
            if (destAmount > _maxDestAmount) {
                destAmount = _maxDestAmount;
                srcAmount = _maxDestAmount.mul(10**(36 - tokens[address(_dest)].decimals)).div(expectedRate);
            } else {
                srcAmount = _srcAmount;
            }
            require(msg.value >= srcAmount, "not enough ETH provided");
            if (msg.value > srcAmount) {
                // refund
                msg.sender.transfer(msg.value - srcAmount);
            }
            require(ERC20(_dest).transfer(_destAddress, destAmount), "ERC20 transfer failed");
        } else if (address(_dest) == ETH_TOKEN_ADDRESS) {
            expectedRate = tokens[address(_src)].rate;
            destAmount = expectedRate.mul(_srcAmount).div(10**tokens[address(_src)].decimals);
            if (destAmount > _maxDestAmount) {
                destAmount = _maxDestAmount;
                srcAmount = _maxDestAmount.mul(10**tokens[address(_src)].decimals).div(expectedRate);
            } else {
                srcAmount = _srcAmount;
            }
            require(_src.transferFrom(msg.sender, address(this), srcAmount), "not enough ERC20 provided");
            _destAddress.transfer(destAmount);
        } else {
            revert("Unknown token pair");
        }
    }
}
