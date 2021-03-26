pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "./IWhitelisted.sol";
import "./lib/IExchange.sol";
import "./lib/Utils.sol";
import "./TokenTransferProxy.sol";
import "./IPartnerRegistry.sol";
import "./IPartner.sol";
import "./lib/TokenFetcherAugustus.sol";
import "./IWETH.sol";
import "./IUniswapProxy.sol";
import "./AdapterStorage.sol";
import "./ITokenTransferProxy.sol";


contract AugustusSwapper is AdapterStorage, TokenFetcherAugustus {
    using SafeMath for uint256;

    IWhitelisted private _whitelisted;

    IPartnerRegistry private _partnerRegistry;

    address payable private _feeWallet;

    address private _uniswapProxy;

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

    event AdapterInitialized(address indexed adapter);

    modifier onlySelf() {
        require(
            msg.sender == address(this),
            "AugustusSwapper: Invalid access"
        );
        _;
    }

    receive () payable external {

    }

    function initialize(
        address whitelist,
        address reduxToken,
        address partnerRegistry,
        address payable feeWallet,
        address uniswapProxy
    )
        external
    {
        require(address(_tokenTransferProxy) == address(0), "Contract already initialized!!");
        _partnerRegistry = IPartnerRegistry(partnerRegistry);
        TokenTransferProxy lTokenTransferProxy = new TokenTransferProxy(reduxToken);
        _tokenTransferProxy = ITokenTransferProxy(lTokenTransferProxy);
        _whitelisted = IWhitelisted(whitelist);
        _feeWallet = feeWallet;
        _uniswapProxy = uniswapProxy;
        _owner = msg.sender;
    }

    function initializeAdapter(address adapter, bytes calldata data) external onlyOwner {

        require(
            _whitelisted.hasRole(_whitelisted.WHITELISTED_ROLE(), adapter),
            "Exchange not whitelisted"
        );
        (bool success,) = adapter.delegatecall(abi.encodeWithSelector(IExchange.initialize.selector, data));
        require(success, "Failed to initialize adapter");
        emit AdapterInitialized(adapter);
    }

    function getUniswapProxy() external view returns(address) {
        return _uniswapProxy;
    }

    function getVersion() external view returns(string memory) {
        return "4.0.0";
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

    function changeUniswapProxy(address uniswapProxy) external onlyOwner {
        require(uniswapProxy != address(0), "Invalid address");
        _uniswapProxy = uniswapProxy;
    }

    function setFeeWallet(address payable feeWallet) external onlyOwner {
        require(feeWallet != address(0), "Invalid address");
        _feeWallet = feeWallet;
    }

    function setPartnerRegistry(address partnerRegistry) external onlyOwner {
        require(partnerRegistry != address(0), "Invalid address");
        _partnerRegistry = IPartnerRegistry(partnerRegistry);
    }

    function setWhitelistAddress(address whitelisted) external onlyOwner {
        require(whitelisted != address(0), "Invalid whitelist address");
        _whitelisted = IWhitelisted(whitelisted);
    }

    function swapOnUniswap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint8 referrer
    )
        external
        payable
    {
        //DELEGATING CALL TO THE ADAPTER
        (bool success, bytes memory result) = _uniswapProxy.delegatecall(
            abi.encodeWithSelector(
                IUniswapProxy.swapOnUniswap.selector,
                amountIn,
                amountOutMin,
                path
            )
        );
        // require(success, "Call to uniswap proxy failed");
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

    }

    function buyOnUniswap(
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path,
        uint8 referrer
    )
        external
        payable
    {
        //DELEGATING CALL TO THE ADAPTER
        (bool success, bytes memory result) = _uniswapProxy.delegatecall(
            abi.encodeWithSelector(
                IUniswapProxy.buyOnUniswap.selector,
                amountInMax,
                amountOut,
                path
            )
        );
        require(success, "Call to uniswap proxy failed");

    }

    function buyOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata path,
        uint8 referrer
    )
        external
        payable
    {
        //DELEGATING CALL TO THE ADAPTER
        (bool success, bytes memory result) = _uniswapProxy.delegatecall(
            abi.encodeWithSelector(
                IUniswapProxy.buyOnUniswapFork.selector,
                factory,
                initCode,
                amountInMax,
                amountOut,
                path
            )
        );
        require(success, "Call to uniswap proxy failed");

    }

    function swapOnUniswapFork(
        address factory,
        bytes32 initCode,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint8 referrer
    )
        external
        payable

    {
        //DELEGATING CALL TO THE ADAPTER
        (bool success, bytes memory result) = _uniswapProxy.delegatecall(
            abi.encodeWithSelector(
                IUniswapProxy.swapOnUniswapFork.selector,
                factory,
                initCode,
                amountIn,
                amountOutMin,
                path
            )
        );
        // require(success, "Call to uniswap proxy failed");
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        

    }

    // function simplBuy(
    //     address fromToken,
    //     address toToken,
    //     uint256 fromAmount,
    //     uint256 toAmount,
    //     address[] memory callees,
    //     bytes memory exchangeData,
    //     uint256[] memory startIndexes,
    //     uint256[] memory values,
    //     address payable beneficiary,
    //     string memory referrer,
    //     bool useReduxToken
    // )
    //     external
    //     payable

    // {
    //     uint receivedAmount = performSimpleSwap(
    //         fromToken,
    //         toToken,
    //         fromAmount,
    //         toAmount,
    //         toAmount,//expected amount and to amount are same in case of buy
    //         callees,
    //         exchangeData,
    //         startIndexes,
    //         values,
    //         beneficiary,
    //         referrer,
    //         useReduxToken
    //     );

    //     uint256 remainingAmount = Utils.tokenBalance(
    //         fromToken,
    //         address(this)
    //     );

    //     if (remainingAmount > 0) {
    //         Utils.transferTokens(address(fromToken), msg.sender, remainingAmount);
    //     }

    //     emit Bought(
    //         msg.sender,
    //         beneficiary == address(0) ? msg.sender:beneficiary,
    //         fromToken,
    //         toToken,
    //         fromAmount,
    //         receivedAmount,
    //         referrer
    //     );
    // }

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
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer//,
        // bool useReduxToken
    )
        public
        payable
        returns (uint256 receivedAmount)
    {

        receivedAmount = performSimpleSwap(
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
            referrer,
            false//useReduxToken
        );

        emit Swapped(
            msg.sender,
            beneficiary == address(0)?msg.sender:beneficiary,
            fromToken,
            toToken,
            fromAmount,
            receivedAmount,
            expectedAmount,
            referrer
        );

        return receivedAmount;
    }

    function transferTokensFromProxy(
        address token,
        uint256 amount
    )
      private
    {
        if (token != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                token,
                msg.sender,
                address(this),
                amount
            );
        }
    }

    function performSimpleSwap(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer,
        bool useReduxToken
    )
        private
        returns (uint256 receivedAmount)
    {
        require(toAmount > 0, "toAmount is too low");
        require(
            callees.length + 1 == startIndexes.length,
            "Start indexes must be 1 greater then number of callees"
        );

        uint initialGas = gasleft();

        //If source token is not ETH than transfer required amount of tokens
        //from sender to this contract
        transferTokensFromProxy(fromToken, fromAmount);

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
            // require(result, "External call failed");
            if (!result) {
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
        }

        receivedAmount = Utils.tokenBalance(
            toToken,
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

        if (useReduxToken) {
            Utils.refundGas(msg.sender, address(_tokenTransferProxy), initialGas);
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
        returns (uint256)
    {
        uint initialGas = gasleft();

        address fromToken = data.fromToken;
        uint256 fromAmount = data.fromAmount;
        uint256 toAmount = data.toAmount;
        uint256 expectedAmount = data.expectedAmount;
        address payable beneficiary = data.beneficiary == address(0) ? msg.sender : data.beneficiary;
        string memory referrer = data.referrer;
        Utils.Path[] memory path = data.path;
        address toToken = path[path.length - 1].to;
        bool useReduxToken = data.useReduxToken;

        //Referral can never be empty
        require(bytes(referrer).length > 0, "Invalid referrer");

        require(toAmount > 0, "To amount can not be 0");

        //if fromToken is not ETH then transfer tokens from user to this contract
        if (fromToken != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                fromToken,
                msg.sender,
                address(this),
                fromAmount
            );
        }

        performSwap(
            fromToken,
            fromAmount,
            path
        );


        uint256 receivedAmount = Utils.tokenBalance(
            toToken,
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

        if (useReduxToken) {
            Utils.refundGas(msg.sender, address(_tokenTransferProxy), initialGas);
        }

        emit Swapped(
            msg.sender,
            beneficiary,
            fromToken,
            toToken,
            fromAmount,
            receivedAmount,
            expectedAmount,
            referrer
        );

        return receivedAmount;
    }

    /**
   * @dev The function which performs the mega path swap.
   * @param data Data required to perform swap.
   */
    function megaSwap(
        Utils.MegaSwapSellData memory data
    )
        public
        payable
        returns (uint256)
    {
        uint initialGas = gasleft();

        address fromToken = data.fromToken;
        uint256 fromAmount = data.fromAmount;
        uint256 toAmount = data.toAmount;
        uint256 expectedAmount = data.expectedAmount;
        address payable beneficiary = data.beneficiary == address(0) ? msg.sender : data.beneficiary;
        string memory referrer = data.referrer;
        Utils.MegaSwapPath[] memory path = data.path;
        address toToken = path[0].path[path[0].path.length - 1].to;
        bool useReduxToken = data.useReduxToken;

        //Referral can never be empty
        require(bytes(referrer).length > 0, "Invalid referrer");

        require(toAmount > 0, "To amount can not be 0");

        //if fromToken is not ETH then transfer tokens from user to this contract
        if (fromToken != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                fromToken,
                msg.sender,
                address(this),
                fromAmount
            );
        }

        for (uint8 i = 0; i < uint8(path.length); i++) {
            uint256 _fromAmount = fromAmount.mul(path[i].fromAmountPercent).div(10000);
            if (i == path.length - 1) {
                _fromAmount = Utils.tokenBalance(address(fromToken), address(this));
            }
            performSwap(
                fromToken,
                _fromAmount,
                path[i].path
            );
        }

        uint256 receivedAmount = Utils.tokenBalance(
            toToken,
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

        if (useReduxToken) {
            Utils.refundGas(msg.sender, address(_tokenTransferProxy), initialGas);
        }

        emit Swapped(
            msg.sender,
            beneficiary,
            fromToken,
            toToken,
            fromAmount,
            receivedAmount,
            expectedAmount,
            referrer
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
        returns (uint256)
    {

        address fromToken = data.fromToken;
        uint256 fromAmount = data.fromAmount;
        uint256 toAmount = data.toAmount;
        address payable beneficiary = data.beneficiary == address(0) ? msg.sender : data.beneficiary;
        string memory referrer = data.referrer;
        Utils.BuyRoute[] memory route = data.route;
        address toToken = data.toToken;
        bool useReduxToken = data.useReduxToken;

        //Referral id can never be empty
        require(bytes(referrer).length > 0, "Invalid referrer");

        require(toAmount > 0, "To amount can not be 0");

        uint256 receivedAmount = performBuy(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            route,
            useReduxToken
        );

        takeFeeAndTransferTokens(
            toToken,
            toAmount,
            receivedAmount,
            beneficiary,
            referrer
        );

        uint256 remainingAmount = Utils.tokenBalance(
            fromToken,
            address(this)
        );

        if (remainingAmount > 0) {
            Utils.transferTokens(fromToken, msg.sender, remainingAmount);
        }

        emit Bought(
            msg.sender,
            beneficiary,
            fromToken,
            toToken,
            fromAmount,
            receivedAmount,
            referrer
        );

        return receivedAmount;
    }

    //Helper function to transfer final amount to the beneficiaries
    function takeFeeAndTransferTokens(
        address toToken,
        uint256 expectedAmount,
        uint256 receivedAmount,
        address payable beneficiary,
        string memory referrer

    )
        private
    {
        uint256 remainingAmount = receivedAmount;

        address partnerContract = _partnerRegistry.getPartnerContract(referrer);

        //Take partner fee
        ( uint256 fee ) = _takeFee(
            toToken,
            receivedAmount,
            expectedAmount,
            partnerContract
        );
        remainingAmount = receivedAmount.sub(fee);

        //If there is a positive slippage after taking partner fee then 50% goes to paraswap and 50% to the user
        if ((remainingAmount > expectedAmount) && fee == 0) {
            uint256 positiveSlippageShare = remainingAmount.sub(expectedAmount).div(2);
            remainingAmount = remainingAmount.sub(positiveSlippageShare);
            Utils.transferTokens(toToken, _feeWallet, positiveSlippageShare);
        }

        Utils.transferTokens(toToken, beneficiary, remainingAmount);


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
        address fromToken,
        uint256 fromAmount,
        Utils.Path[] memory path
    )
        private
        returns(uint256)
    {

        require(path.length > 0, "Path not provided for swap");

        //Assuming path will not be too long to reach out of gas exception
        for (uint i = 0; i < path.length; i++) {
            //_fromToken will be either fromToken or toToken of the previous path
            address _fromToken = i > 0 ? path[i - 1].to : fromToken;
            address _toToken = path[i].to;

            uint256 _fromAmount = i > 0 ? Utils.tokenBalance(_fromToken, address(this)) : fromAmount;
            if (i > 0 && _fromToken == Utils.ethAddress()) {
                _fromAmount = _fromAmount.sub(path[i].totalNetworkFee);
            }

            for (uint j = 0; j < path[i].routes.length; j++) {
                Utils.Route memory route = path[i].routes[j];

                //Check if exchange is supported
                require(
                    _whitelisted.hasRole(_whitelisted.WHITELISTED_ROLE(), route.exchange),
                    "Exchange not whitelisted"
                );

                //Calculating tokens to be passed to the relevant exchange
                //percentage should be 200 for 2%
                uint fromAmountSlice = _fromAmount.mul(route.percent).div(10000);
                uint256 value = route.networkFee;

                if (i > 0 && j == path[i].routes.length.sub(1)) {
                    uint256 remBal = Utils.tokenBalance(address(_fromToken), address(this));

                    fromAmountSlice = remBal;

                    if (address(_fromToken) == Utils.ethAddress()) {
                        //subtract network fee
                        fromAmountSlice = fromAmountSlice.sub(value);
                    }
                }

                //DELEGATING CALL TO THE ADAPTER
                (bool success,) = route.exchange.delegatecall(
                    abi.encodeWithSelector(
                        IExchange.swap.selector,
                        _fromToken,
                        _toToken,
                        fromAmountSlice,
                        1,
                        route.targetExchange,
                        route.payload
                    )
                );

                require(success, "Call to adapter failed");
            }
        }
    }

    //Helper function to perform swap
    function performBuy(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        Utils.BuyRoute[] memory routes,
        bool useReduxToken
    )
        private
        returns(uint256)
    {
        uint initialGas = gasleft();

        //if fromToken is not ETH then transfer tokens from user to this contract
        if (fromToken != Utils.ethAddress()) {
            _tokenTransferProxy.transferFrom(
                fromToken,
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

            //delegate Call to the exchange
            (bool success,) = route.exchange.delegatecall(
                abi.encodeWithSelector(
                    IExchange.buy.selector,
                    fromToken,
                    toToken,
                    route.fromAmount,
                    route.toAmount,
                    route.targetExchange,
                    route.payload
                )
            );
            require(success, "Call to adapter failed");
        }

        uint256 receivedAmount = Utils.tokenBalance(
            toToken,
            address(this)
        );
        require(
            receivedAmount >= toAmount,
            "Received amount of tokens are less then expected tokens"
        );

        if (useReduxToken) {
            Utils.refundGas(msg.sender, address(_tokenTransferProxy), initialGas);
        }
        return receivedAmount;
    }

    function _takeFee(
        address toToken,
        uint256 receivedAmount,
        uint256 expectedAmount,
        address partnerContract
    )
        private
        returns(uint256 fee)
    {
        //If there is no partner associated with the referral id then no fee will be taken
        if (partnerContract == address(0)) {
            return (0);
        }

        (
            address payable partnerFeeWallet,
            uint256 feePercent,
            uint256 partnerSharePercent,
            ,
            bool positiveSlippageToUser,
            bool noPositiveSlippage
        ) = IPartner(partnerContract).getPartnerInfo();

        uint256 partnerShare = 0;
        uint256 paraswapShare = 0;

        if (!noPositiveSlippage && feePercent <= 50 && receivedAmount > expectedAmount) {
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
        Utils.transferTokens(toToken, partnerFeeWallet, partnerShare);
        Utils.transferTokens(toToken, _feeWallet, paraswapShare);

        emit FeeTaken(fee, partnerShare, paraswapShare);
        return (fee);
    }
}
