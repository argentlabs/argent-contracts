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


contract AugustusSwapperMock is AdapterStorage {
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

    event AdapterInitialized(address indexed adapter);


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
    }

    function initializeAdapter(address adapter, bytes calldata data) external {

        require(
            _whitelisted.hasRole(_whitelisted.WHITELISTED_ROLE(), adapter),
            "Exchange not whitelisted"
        );
        (bool success,) = adapter.delegatecall(abi.encodeWithSelector(IExchange.initialize.selector, data));
        // require(success, "Failed to initialize adapter");
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        emit AdapterInitialized(adapter);
    }

    function getUniswapProxy() external view returns(address) {
        return _uniswapProxy;
    }

    function changeUniswapProxy(address uniswapProxy) external {
        _uniswapProxy = uniswapProxy;
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

                // require(success, "Call to adapter failed");
                if (!success) {
                    // solhint-disable-next-line no-inline-assembly
                    assembly {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                }
            }
        }
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
        return 0;
    }

    //
    // HACK TO ALLOW COMPILATION OF SIMPLESWAP WITH NO OPTIMIZATION
    //

    struct SimpleSwapData {
        address fromToken;
        address toToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address[] callees;
        bytes exchangeData;
        uint256[] startIndexes;
        uint256[] values;
        address payable beneficiary;
        string referrer;
        bool useReduxToken;
    }

    function simpleSwapWithStruct(
        SimpleSwapData memory ssd
    )
        internal
        returns (uint256 receivedAmount)
    {
        ssd.beneficiary = ssd.beneficiary == address(0) ? msg.sender : ssd.beneficiary;
        receivedAmount = performSimpleSwap(
            ssd.fromToken,
            ssd.toToken,
            ssd.fromAmount,
            ssd.toAmount,
            ssd.expectedAmount,
            ssd.callees,
            ssd.exchangeData,
            ssd.startIndexes,
            ssd.values,
            ssd.beneficiary,
            ssd.referrer,
            ssd.useReduxToken
        );

        emit Swapped(
            msg.sender,
            ssd.beneficiary == address(0)?msg.sender:ssd.beneficiary,
            ssd.fromToken,
            ssd.toToken,
            ssd.fromAmount,
            receivedAmount,
            ssd.expectedAmount,
            ssd.referrer
        );

        return receivedAmount;
    }
  
    bytes4 constant internal SIMPLESWAP = bytes4(keccak256(
        "simpleSwap(address,address,uint256,uint256,uint256,address[],bytes,uint256[],uint256[],address,string,bool)"
    ));

    function decodeSimpleSwapData1() internal pure returns (address fromToken, address toToken, uint fromAmount, uint toAmount, uint expectedAmount) {
         (
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            expectedAmount
        ) = abi.decode(msg.data[4:], (address, address, uint, uint, uint));
    }

    function decodeSimpleSwapData2() internal pure returns (
        address[] memory callees,
        bytes memory exchangeData,
        uint256[] memory startIndexes,
        uint256[] memory values,
        address payable beneficiary,
        string memory referrer,
        bool useReduxToken
    ) {
         (,
            callees,
            exchangeData,
            startIndexes,
            values,
            beneficiary,
            referrer,
            useReduxToken
        ) = abi.decode(msg.data[4:], (uint[5], address[], bytes, uint256[], uint256[], address, string, bool));
    }

    fallback() external payable {
        if(msg.sig == SIMPLESWAP) {
            SimpleSwapData memory ssd;
            (ssd.fromToken, ssd.toToken, ssd.fromAmount, ssd.toAmount, ssd.expectedAmount)  = decodeSimpleSwapData1();
            (ssd.callees, ssd.exchangeData, ssd.startIndexes, ssd.values,
                ssd.beneficiary, ssd.referrer, ssd.useReduxToken) = decodeSimpleSwapData2();
            simpleSwapWithStruct(ssd);
        }
    }
}
