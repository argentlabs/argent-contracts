pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./IWhitelisted.sol";
import "./lib/IExchange.sol";
import "./lib/Utils.sol";
import "./TokenTransferProxy.sol";
import "./IPartnerRegistry.sol";
import "./IPartner.sol";
import "./lib/TokenFetcher.sol";
import "./IWETH.sol";

contract AugustusSwapper is Ownable, TokenFetcher {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    TokenTransferProxy private _tokenTransferProxy;

    bool private _paused;

    IWhitelisted private _whitelisted;

    IPartnerRegistry private _partnerRegistry;
    address payable private _feeWallet;

    string private _version = "2.1.0";
    uint256 private _gasMintPrice;

    event Paused();
    event Unpaused();

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

    event Bought(
        address initiator,
        address indexed beneficiary,
        address indexed srcToken,
        address indexed destToken,
        uint256 srcAmount,
        uint256 receivedAmount,
        string referrer
    );

    event FeeTaken(
        uint256 fee,
        uint256 partnerShare,
        uint256 paraswapShare
    );

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

    modifier onlySelf() {
      require(
        msg.sender == address(this),
        "AugustusSwapper: Invalid access"
      );
      _;
    }


  constructor(
        address whitelist,
        address gasToken,
        address partnerRegistry,
        address payable feeWallet,
        address gstHolder
    )
        public
    {

        _partnerRegistry = IPartnerRegistry(partnerRegistry);
        _tokenTransferProxy = new TokenTransferProxy(gasToken, gstHolder);
        _whitelisted = IWhitelisted(whitelist);
        _feeWallet = feeWallet;
        _gasMintPrice = 1;
    }

    /**
    * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
    */
    receive() external payable {
    }

    function getVersion() external view returns(string memory) {
        return _version;
    }

    function getPartnerRegistry() external view returns(address) {
        return address(_partnerRegistry);
    }

    function getWhitelistAddress() external view returns(address) {
        return address(_whitelisted);
    }

    function getFeeWallet() external view returns(address) {
        return _feeWallet;
    }

    function setFeeWallet(address payable feeWallet) external onlyOwner {
        require(feeWallet != address(0), "Invalid address");
        _feeWallet = feeWallet;
    }

    function getGasMintPrice() external view returns(uint) {
        return _gasMintPrice;
    }

    function setGasMintPrice(uint gasMintPrice) external onlyOwner {
        _gasMintPrice = gasMintPrice;
    }

    function setPartnerRegistry(address partnerRegistry) external onlyOwner {
        require(partnerRegistry != address(0), "Invalid address");
        _partnerRegistry = IPartnerRegistry(partnerRegistry);
    }

    function setWhitelistAddress(address whitelisted) external onlyOwner {
        require(whitelisted != address(0), "Invalid whitelist address");
        _whitelisted = IWhitelisted(whitelisted);
    }

    function getTokenTransferProxy() external view returns (address) {
        return address(_tokenTransferProxy);
    }

    function changeGSTHolder(address gstHolder) external onlyOwner {
        require(gstHolder != address(0), "Invalid address");
        _tokenTransferProxy.changeGSTTokenHolder(gstHolder);
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

    function simplBuy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer
    )
        external
        payable
        whenNotPaused
    {
        uint receivedAmount = performSimpleSwap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            toAmount,//expected amount and to amount are same in case of buy
            callees,
            exchangeData,
            startIndexes,
            values,
            beneficiary,
            referrer
        );

        uint256 remainingAmount = Utils.tokenBalance(
            address(fromToken),
            address(this)
        );

        if (remainingAmount > 0) {
            Utils.transferTokens(address(fromToken), msg.sender, remainingAmount);
        }

        emit Bought(
            msg.sender,
            beneficiary == address(0)?msg.sender:beneficiary,
            address(fromToken),
            address(toToken),
            fromAmount,
            receivedAmount,
            referrer
        );
    }

    function approve(
      address token,
      address to,
      uint256 amount
    )
      external
      onlySelf
    {
      Utils.approve(to, token, amount);
    }


    function simpleSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer
    )
        public
        payable
        whenNotPaused
        returns (uint256)
    {

        uint receivedAmount = performSimpleSwap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            expectedAmount,
            callees,
            exchangeData,
            startIndexes,
            values,
            beneficiary,
            referrer
        );

        emit Swapped(
            msg.sender,
            beneficiary == address(0)?msg.sender:beneficiary,
            address(fromToken),
            address(toToken),
            fromAmount,
            receivedAmount,
            expectedAmount,
            referrer
        );

        return receivedAmount;
    }

    function performSimpleSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer
    )
        private
        returns (uint256)
    {
        require(toAmount > 0, "toAmount is too low");
        require(callees.length > 0, "No callee provided");
        require(exchangeData.length > 0, "No exchangeData provided");
        require(
            callees.length + 1 == startIndexes.length,
            "Start indexes must be 1 greater then number of callees"
        );

        uint initialGas = gasleft();

        //If source token is not ETH than transfer required amount of tokens
        //from sender to this contract
        if (address(fromToken) != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                address(fromToken),
                msg.sender,
                address(this),
                fromAmount
            );
        }

        for (uint256 i = 0; i < callees.length; i++) {
            require(
                callees[i] != address(_tokenTransferProxy),
                "Can not call TokenTransferProxy Contract"
            );

            bool result = externalCall(
                callees[i], //destination
                values[i], //value to send
                startIndexes[i], // start index of call data
                startIndexes[i + 1].sub(startIndexes[i]), // length of calldata
                exchangeData// total calldata
            );
            require(result, "External call failed");
        }

        uint256 receivedAmount = Utils.tokenBalance(
            address(toToken),
            address(this)
        );

        require(
            receivedAmount >= toAmount,
            "Received amount of tokens are less then expected"
        );

        takeFeeAndTransferTokens(
            toToken,
            expectedAmount,
            receivedAmount,
            beneficiary,
            referrer
        );

        if(_gasMintPrice > 0) {
          Utils.refundGas(address(_tokenTransferProxy), initialGas, _gasMintPrice);
        }

        return receivedAmount;
    }

    /**
   * @dev This function sends the WETH returned during the exchange to the user.
   * @param token: The WETH Address
   */
    function withdrawAllWETH(IWETH token) external {
        uint256 amount = token.balanceOf(address(this));
        token.withdraw(amount);
    }

    /**
   * @dev The function which performs the multi path swap.
   * @param data Data required to perform swap.
   */
    function multiSwap(
        Utils.SellData memory data
    )
        public
        payable
        whenNotPaused
        returns (uint256)
    {
        //Referral can never be empty
        require(bytes(data.referrer).length > 0, "Invalid referrer");

        require(data.toAmount > 0, "To amount can not be 0");

        uint256 receivedAmount = performSwap(
            data.fromToken,
            data.toToken,
            data.fromAmount,
            data.toAmount,
            data.path
        );

        takeFeeAndTransferTokens(
            data.toToken,
            data.expectedAmount,
            receivedAmount,
            data.beneficiary,
            data.referrer
        );

        emit Swapped(
            msg.sender,
            data.beneficiary == address(0)?msg.sender:data.beneficiary,
            address(data.fromToken),
            address(data.toToken),
            data.fromAmount,
            receivedAmount,
            data.expectedAmount,
            data.referrer
        );

        return receivedAmount;
    }

    /**
   * @dev The function which performs the single path buy.
   * @param data Data required to perform swap.
   */
    function buy(
        Utils.BuyData memory data
    )
        public
        payable
        whenNotPaused
        returns (uint256)
    {
        //Referral id can never be empty
        require(bytes(data.referrer).length > 0, "Invalid referrer");

        require(data.toAmount > 0, "To amount can not be 0");

        uint256 receivedAmount = performBuy(
            data.fromToken,
            data.toToken,
            data.fromAmount,
            data.toAmount,
            data.route
        );

        takeFeeAndTransferTokens(
            data.toToken,
            data.toAmount,
            receivedAmount,
            data.beneficiary,
            data.referrer
        );

        uint256 remainingAmount = Utils.tokenBalance(
            address(data.fromToken),
            address(this)
        );

        if (remainingAmount > 0) {
            Utils.transferTokens(address(data.fromToken), msg.sender, remainingAmount);
        }

        emit Bought(
            msg.sender,
            data.beneficiary == address(0)?msg.sender:data.beneficiary,
            address(data.fromToken),
            address(data.toToken),
            data.fromAmount,
            receivedAmount,
            data.referrer
        );

        return receivedAmount;
    }

    //Helper function to transfer final amount to the beneficiaries
    function takeFeeAndTransferTokens(
        IERC20 toToken,
        uint256 expectedAmount,
        uint256 receivedAmount,
        address payable beneficiary,
        string memory referrer

    )
        private
    {
        uint256 remainingAmount = receivedAmount;

        //Take partner fee
        ( uint256 fee ) = _takeFee(
            toToken,
            receivedAmount,
            expectedAmount,
            referrer
        );
        remainingAmount = receivedAmount.sub(fee);

        //If there is a positive slippage after taking partner fee then 50% goes to paraswap and 50% to the user
        if ((remainingAmount > expectedAmount) && fee == 0) {
            uint256 positiveSlippageShare = remainingAmount.sub(expectedAmount).div(2);
            remainingAmount = remainingAmount.sub(positiveSlippageShare);
            Utils.transferTokens(address(toToken), _feeWallet, positiveSlippageShare);
        }



        //If beneficiary is not a 0 address then it means it is a transfer transaction
        if (beneficiary == address(0)){
            Utils.transferTokens(address(toToken), msg.sender, remainingAmount);
        }
        else {
            Utils.transferTokens(address(toToken), beneficiary, remainingAmount);
        }

    }

    /**
    * @dev Source take from GNOSIS MultiSigWallet
    * @dev https://github.com/gnosis/MultiSigWallet/blob/master/contracts/MultiSigWallet.sol
    */
    function externalCall(
        address destination,
        uint256 value,
        uint256 dataOffset,
        uint dataLength,
        bytes memory data
    )
    private
    returns (bool)
    {
        bool result = false;

        assembly {
            let x := mload(0x40)   // "Allocate" memory for output (0x40 is where "free memory" pointer is stored by convention)

            let d := add(data, 32) // First 32 bytes are the padded length of data, so exclude that
            result := call(
                sub(gas(), 34710), // 34710 is the value that solidity is currently emitting
                // It includes callGas (700) + callVeryLow (3, to pay for SUB) + callValueTransferGas (9000) +
                // callNewAccountGas (25000, in case the destination address does not exist and needs creating)
                destination,
                value,
                add(d, dataOffset),
                dataLength, // Size of the input (in bytes) - this is what fixes the padding problem
                x,
                0                  // Output is ignored, therefore the output size is zero
            )
        }
        return result;
    }

    //Helper function to perform swap
    function performSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        Utils.Path[] memory path
    )
        private
        returns(uint256)
    {
        uint initialGas = gasleft();

        require(path.length > 0, "Path not provided for swap");
        require(
            path[path.length - 1].to == address(toToken),
            "Last to token does not match toToken"
        );

        //if fromToken is not ETH then transfer tokens from user to this contract
        if (address(fromToken) != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                address(fromToken),
                msg.sender,
                address(this),
                fromAmount
            );
        }

        //Assuming path will not be too long to reach out of gas exception
        for (uint i = 0; i < path.length; i++) {
            //_fromToken will be either fromToken of toToken of the previous path
            IERC20 _fromToken = i > 0 ? IERC20(path[i - 1].to) : IERC20(fromToken);
            IERC20 _toToken = IERC20(path[i].to);

            uint _fromAmount = Utils.tokenBalance(address(_fromToken), address(this));
            if (i > 0 && address(_fromToken) == Utils.ethAddress()) {
                _fromAmount = _fromAmount.sub(path[i].totalNetworkFee);
            }

            for (uint j = 0; j < path[i].routes.length; j++) {
                Utils.Route memory route = path[i].routes[j];

                //Check if exchange is supported
                require(
                    _whitelisted.hasRole(_whitelisted.WHITELISTED_ROLE(), route.exchange),
                    "Exchange not whitelisted"
                );

                IExchange dex = IExchange(route.exchange);

                //Calculating tokens to be passed to the relevant exchange
                //percentage should be 200 for 2%
                uint fromAmountSlice = _fromAmount.mul(route.percent).div(10000);
                uint256 value = route.networkFee;

                if (j == path[i].routes.length.sub(1)) {
                    uint256 remBal = Utils.tokenBalance(address(_fromToken), address(this));

                    fromAmountSlice = remBal;

                    if (address(_fromToken) == Utils.ethAddress()) {
                        //subtract network fee
                        fromAmountSlice = fromAmountSlice.sub(value);
                    }
                }

                //Call to the exchange
                if (address(_fromToken) == Utils.ethAddress()) {
                    value = value.add(fromAmountSlice);

                    dex.swap{value: value}(_fromToken, _toToken, fromAmountSlice, 1, route.targetExchange, route.payload);
                }
                else {
                    _fromToken.safeTransfer(route.exchange, fromAmountSlice);

                    dex.swap{value: value}(_fromToken, _toToken, fromAmountSlice, 1, route.targetExchange, route.payload);
                }
            }
        }

        uint256 receivedAmount = Utils.tokenBalance(
            address(toToken),
            address(this)
        );
        require(
            receivedAmount >= toAmount,
            "Received amount of tokens are less then expected"
        );

        if (_gasMintPrice > 0) {
            Utils.refundGas(address(_tokenTransferProxy), initialGas, _gasMintPrice);
        }
        return receivedAmount;
    }

    //Helper function to perform swap
    function performBuy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        Utils.BuyRoute[] memory routes
    )
        private
        returns(uint256)
    {
        uint initialGas = gasleft();
        IERC20 _fromToken = fromToken;
        IERC20 _toToken = toToken;

        //if fromToken is not ETH then transfer tokens from user to this contract
        if (address(_fromToken) != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                address(_fromToken),
                msg.sender,
                address(this),
                fromAmount
            );
        }

        for (uint j = 0; j < routes.length; j++) {
            Utils.BuyRoute memory route = routes[j];

            //Check if exchange is supported
            require(
                _whitelisted.hasRole(_whitelisted.WHITELISTED_ROLE(), route.exchange),
                "Exchange not whitelisted"
            );
            IExchange dex = IExchange(route.exchange);


            //Call to the exchange
            if (address(_fromToken) == Utils.ethAddress()) {
                uint256 value = route.networkFee.add(route.fromAmount);
                dex.buy{value: value}(
                    _fromToken,
                    _toToken,
                    route.fromAmount,
                    route.toAmount,
                    route.targetExchange,
                    route.payload
                );
            }
            else {
                _fromToken.safeTransfer(route.exchange, route.fromAmount);
                dex.buy{value: route.networkFee}(
                    _fromToken,
                    _toToken,
                    route.fromAmount,
                    route.toAmount,
                    route.targetExchange,
                    route.payload
                );
            }
        }

        uint256 receivedAmount = Utils.tokenBalance(
            address(_toToken),
            address(this)
        );
        require(
            receivedAmount >= toAmount,
            "Received amount of tokens are less then expected tokens"
        );

        if (_gasMintPrice > 0) {
            Utils.refundGas(address(_tokenTransferProxy), initialGas, _gasMintPrice);
        }
        return receivedAmount;
    }

    function _takeFee(
        IERC20 toToken,
        uint256 receivedAmount,
        uint256 expectedAmount,
        string memory referrer
    )
        private
        returns(uint256 fee)
    {

        address partnerContract = _partnerRegistry.getPartnerContract(referrer);

        //If there is no partner associated with the referral id then no fee will be taken
        if (partnerContract == address(0)) {
            return (0);
        }

        (
            address payable partnerFeeWallet,
            uint256 feePercent,
            uint256 partnerSharePercent,
            ,
            bool positiveSlippageToUser
        ) = IPartner(partnerContract).getPartnerInfo();

        uint256 partnerShare = 0;
        uint256 paraswapShare = 0;

        if (feePercent <= 50 && receivedAmount > expectedAmount) {
            uint256 halfPositiveSlippage = receivedAmount.sub(expectedAmount).div(2);
            //Calculate total fee to be taken
            fee = expectedAmount.mul(feePercent).div(10000);
            //Calculate partner's share
            partnerShare = fee.mul(partnerSharePercent).div(10000);
            //All remaining fee is paraswap's share
            paraswapShare = fee.sub(partnerShare);
            paraswapShare = paraswapShare.add(halfPositiveSlippage);

            fee = fee.add(halfPositiveSlippage);

            if (!positiveSlippageToUser) {
                partnerShare = partnerShare.add(halfPositiveSlippage);
                fee = fee.add(halfPositiveSlippage);
            }
        }
        else {
            //Calculate total fee to be taken
            fee = receivedAmount.mul(feePercent).div(10000);
            //Calculate partner's share
            partnerShare = fee.mul(partnerSharePercent).div(10000);
            //All remaining fee is paraswap's share
            paraswapShare = fee.sub(partnerShare);
        }
        Utils.transferTokens(address(toToken), partnerFeeWallet, partnerShare);
        Utils.transferTokens(address(toToken), _feeWallet, paraswapShare);

        emit FeeTaken(fee, partnerShare, paraswapShare);
        return (fee);
    }
}
