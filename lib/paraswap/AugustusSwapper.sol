pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";

import "./IWhitelisted.sol";
import "./lib/IExchange.sol";
import "./lib/Utils.sol";
import "./TokenTransferProxy.sol";
import "./IPartnerRegistry.sol";
import "./IPartner.sol";


contract AugustusSwapper is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    TokenTransferProxy private _tokenTransferProxy;

    bool private _paused;

    IWhitelisted private _whitelisted;

    IPartnerRegistry private _partnerRegistry;
    address payable private _feeWallet;

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
        uint256 expectedAmount,
        string referrer
    );

    event Donation(address indexed receiver, uint256 donationPercentage);

    event FeeTaken(uint256 fee, uint256 partnerShare, uint256 paraswapShare);

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

    constructor(
        address whitelist,
        address gasToken,
        address partnerRegistry,
        address payable feeWallet,
        address gstHolder
    ) public {
        _partnerRegistry = IPartnerRegistry(partnerRegistry);
        _tokenTransferProxy = new TokenTransferProxy(gasToken, gstHolder);
        _whitelisted = IWhitelisted(whitelist);
        _feeWallet = feeWallet;
    }

    /**
     * @dev Fallback method to allow exchanges to transfer back ethers for a particular swap
     * It will only allow contracts to send funds to it
     */
    function() external payable whenNotPaused {
        address account = msg.sender;
        require(account.isContract(), "Sender is not a contract");
    }

    function getPartnerRegistry() external view returns (address) {
        return address(_partnerRegistry);
    }

    function getWhitelistAddress() external view returns (address) {
        return address(_whitelisted);
    }

    function getFeeWallet() external view returns (address) {
        return _feeWallet;
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

    /**
     * @dev Allows owner of the contract to transfer tokens any tokens which are assigned to the contract
     * This method is for saftey if by any chance tokens or ETHs are assigned to the contract by mistake
     * @dev token Address of the token to be transferred
     * @dev destination Recepient of the token
     * @dev amount Amount of tokens to be transferred
     */
    function ownerTransferTokens(
        address token,
        address payable destination,
        uint256 amount
    ) external onlyOwner {
        Utils.transferTokens(token, destination, amount);
    }

    // /**
    //  * @dev The function which performs the multi path swap.
    //  * @param fromToken Address of the source token
    //  * @param toToken Address of the destination token
    //  * @param fromAmount Amount of source tokens to be swapped
    //  * @param toAmount Minimum destination token amount expected out of this swap
    //  * @param expectedAmount Expected amount of destination tokens without slippage
    //  * @param path Route to be taken for this swap to take place
    //  * @param mintPrice Price of gas at the time of minting of gas tokens, if any. In wei. 0 means gas token will not be used
    //  * @param beneficiary Beneficiary address
    //  * @param donationPercentage Percentage of returned amount to be transferred to beneficiary, if beneficiary is available. If this is passed as
    //  * 0 then 100% will be transferred to beneficiary. Pass 10000 for 100%
    //  * @param referrer referral id
    //  */
    function multiSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        Utils.Path[] memory path,
        uint256 mintPrice,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) public payable whenNotPaused returns (uint256) {
        //Referral id can never be empty
        require(bytes(referrer).length > 0, "Invalid referrer");

        require(donationPercentage <= 10000, "Invalid value");

        require(toAmount > 0, "To amount can not be 0");

        uint256 receivedAmount = performSwap(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            path,
            mintPrice
        );

        takeFeeAndTransferTokens(
            toToken,
            toAmount,
            receivedAmount,
            beneficiary,
            donationPercentage,
            referrer
        );

        //If any ether is left at this point then we transfer it back to the user
        uint256 remEthBalance = Utils.tokenBalance(
            Utils.ethAddress(),
            address(this)
        );
        if (remEthBalance > 0) {
            msg.sender.transfer(remEthBalance);
        }

        //Contract should not have any remaining balance after entire execution
        require(
            Utils.tokenBalance(address(toToken), address(this)) == 0,
            "Destination tokens are stuck"
        );

        emit Swapped(
            msg.sender,
            beneficiary == address(0) ? msg.sender : beneficiary,
            address(fromToken),
            address(toToken),
            fromAmount,
            receivedAmount,
            expectedAmount,
            referrer
        );

        return receivedAmount;
    }

    /**
     * @dev The function which performs the single path buy.
     * @param fromToken Address of the source token
     * @param toToken Address of the destination token
     * @param fromAmount Max amount of source tokens to be swapped
     * @param toAmount Destination token amount expected out of this swap
     * @param expectedAmount Expected amount of source tokens to be used without slippage
     * @param route Route to be taken for this swap to take place
     * @param mintPrice Price of gas at the time of minting of gas tokens, if any. In wei. 0 means gas token will not be used
     * @param beneficiary Beneficiary address
     * @param donationPercentage Percentage of returned amount to be transferred to beneficiary, if beneficiary is available. If this is passed as
     * 0 then 100% will be transferred to beneficiary. Pass 10000 for 100%
     * @param referrer referral id
     */
    function buy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 expectedAmount,
        Utils.BuyRoute[] memory route,
        uint256 mintPrice,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) public payable whenNotPaused returns (uint256) {
        //Referral id can never be empty
        require(bytes(referrer).length > 0, "Invalid referrer");

        require(donationPercentage <= 10000, "Invalid value");

        require(toAmount > 0, "To amount can not be 0");

        uint256 receivedAmount = performBuy(
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            route,
            mintPrice
        );

        takeFeeAndTransferTokens(
            toToken,
            toAmount,
            receivedAmount,
            beneficiary,
            donationPercentage,
            referrer
        );

        uint256 remainingAmount = Utils.tokenBalance(
            address(fromToken),
            address(this)
        );
        Utils.transferTokens(address(fromToken), msg.sender, remainingAmount);

        //If any ether is left at this point then we transfer it back to the user
        remainingAmount = Utils.tokenBalance(Utils.ethAddress(), address(this));
        if (remainingAmount > 0) {
            Utils.transferTokens(
                Utils.ethAddress(),
                msg.sender,
                remainingAmount
            );
        }

        //Contract should not have any remaining balance after entire execution
        require(
            Utils.tokenBalance(address(toToken), address(this)) == 0,
            "Destination tokens are stuck"
        );

        emit Bought(
            msg.sender,
            beneficiary == address(0) ? msg.sender : beneficiary,
            address(fromToken),
            address(toToken),
            fromAmount,
            receivedAmount,
            expectedAmount,
            referrer
        );

        return receivedAmount;
    }

    //Helper function to transfer final amount to the beneficiaries
    function takeFeeAndTransferTokens(
        IERC20 toToken,
        uint256 toAmount,
        uint256 receivedAmount,
        address payable beneficiary,
        uint256 donationPercentage,
        string memory referrer
    ) private {
        uint256 remainingAmount = receivedAmount;

        //Take partner fee
        uint256 fee = _takeFee(toToken, receivedAmount, referrer);
        remainingAmount = receivedAmount.sub(fee);

        //If beneficiary is not a 0 address then it means it is a transfer transaction
        if (beneficiary == address(0)) {
            Utils.transferTokens(address(toToken), msg.sender, remainingAmount);
        } else {
            //Extra check of < 100 is made to ensure that in case of 100% we do not send
            //un-necessary transfer call to the msg.sender. This will save some gas
            if (donationPercentage > 0 && donationPercentage < 10000) {
                //Keep donation amount with the contract and send rest to the msg.sender
                uint256 donationAmount = remainingAmount
                    .mul(donationPercentage)
                    .div(10000);

                Utils.transferTokens(
                    address(toToken),
                    msg.sender,
                    remainingAmount.sub(donationAmount)
                );

                remainingAmount = donationAmount;
            }

            //we will fire donation event if donationPercentage is > 0 even if it is 100%
            if (donationPercentage > 0) {
                emit Donation(beneficiary, donationPercentage);
            }

            Utils.transferTokens(
                address(toToken),
                beneficiary,
                remainingAmount
            );
        }
    }

    //Helper function to perform swap
    function performSwap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        Utils.Path[] memory path,
        uint256 mintPrice
    ) private returns (uint256) {
        uint256 initialGas = gasleft();

        uint256 _fromAmount = fromAmount;

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
        for (uint256 i = 0; i < path.length; i++) {
            //_fromToken will be either fromToken of toToken of the previous path
            IERC20 _fromToken = i > 0
                ? IERC20(path[i - 1].to)
                : IERC20(fromToken);
            IERC20 _toToken = IERC20(path[i].to);

            if (i > 0 && address(_fromToken) == Utils.ethAddress()) {
                _fromAmount = _fromAmount.sub(path[i].totalNetworkFee);
            }

            uint256 initialFromBalance = Utils
                .tokenBalance(address(_fromToken), address(this))
                .sub(_fromAmount);

            for (uint256 j = 0; j < path[i].routes.length; j++) {
                Utils.Route memory route = path[i].routes[j];

                //Calculating tokens to be passed to the relevant exchange
                //percentage should be 200 for 2%
                uint256 fromAmountSlice = _fromAmount.mul(route.percent).div(
                    10000
                );
                uint256 value = route.networkFee;

                if (j == path[i].routes.length.sub(1)) {
                    uint256 remBal = Utils.tokenBalance(
                        address(_fromToken),
                        address(this)
                    );

                    fromAmountSlice = remBal;

                    if (address(_fromToken) == Utils.ethAddress()) {
                        //subtract network fee
                        fromAmountSlice = fromAmountSlice.sub(value);
                    }
                }

                //Check if exchange is supported
                require(
                    _whitelisted.isWhitelisted(route.exchange),
                    "Exchange not whitelisted"
                );

                IExchange dex = IExchange(route.exchange);

                Utils.approve(route.exchange, address(_fromToken));

                uint256 initialExchangeFromBalance = Utils.tokenBalance(
                    address(_fromToken),
                    route.exchange
                );
                uint256 initialExchangeToBalance = Utils.tokenBalance(
                    address(_toToken),
                    route.exchange
                );

                //Call to the exchange
                if (address(_fromToken) == Utils.ethAddress()) {
                    value = value.add(fromAmountSlice);

                    dex.swap.value(value)(
                        _fromToken,
                        _toToken,
                        fromAmountSlice,
                        1,
                        route.targetExchange,
                        route.payload
                    );
                } else {
                    _fromToken.safeTransfer(route.exchange, fromAmountSlice);

                    dex.swap.value(value)(
                        _fromToken,
                        _toToken,
                        fromAmountSlice,
                        1,
                        route.targetExchange,
                        route.payload
                    );
                }

                require(
                    Utils.tokenBalance(address(_toToken), route.exchange) <=
                        initialExchangeToBalance,
                    "Destination tokens are stuck in exchange"
                );
                require(
                    Utils.tokenBalance(address(_fromToken), route.exchange) <=
                        initialExchangeFromBalance,
                    "Source tokens are stuck in exchange"
                );
            }

            _fromAmount = Utils.tokenBalance(address(_toToken), address(this));

            //Contract should not have any remaining balance after execution
            require(
                Utils.tokenBalance(address(_fromToken), address(this)) <=
                    initialFromBalance,
                "From tokens are stuck"
            );
        }

        uint256 receivedAmount = Utils.tokenBalance(
            address(toToken),
            address(this)
        );
        require(
            receivedAmount >= toAmount,
            "Received amount of tokens are less then expected"
        );

        if (mintPrice > 0) {
            Utils.refundGas(
                address(_tokenTransferProxy),
                initialGas,
                mintPrice
            );
        }
        return receivedAmount;
    }

    //Helper function to perform swap
    function performBuy(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 fromAmount,
        uint256 toAmount,
        Utils.BuyRoute[] memory routes,
        uint256 mintPrice
    ) private returns (uint256) {
        uint256 initialGas = gasleft();
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

        for (uint256 j = 0; j < routes.length; j++) {
            Utils.BuyRoute memory route = routes[j];

            //Check if exchange is supported
            require(
                _whitelisted.isWhitelisted(route.exchange),
                "Exchange not whitelisted"
            );
            IExchange dex = IExchange(route.exchange);
            Utils.approve(route.exchange, address(_fromToken));

            uint256 initialExchangeFromBalance = Utils.tokenBalance(
                address(_fromToken),
                route.exchange
            );
            uint256 initialExchangeToBalance = Utils.tokenBalance(
                address(_toToken),
                route.exchange
            );
            //Call to the exchange
            if (address(_fromToken) == Utils.ethAddress()) {
                uint256 value = route.networkFee.add(route.fromAmount);
                dex.buy.value(value)(
                    _fromToken,
                    _toToken,
                    route.fromAmount,
                    route.toAmount,
                    route.targetExchange,
                    route.payload
                );
            } else {
                _fromToken.safeTransfer(route.exchange, route.fromAmount);
                dex.buy.value(route.networkFee)(
                    _fromToken,
                    _toToken,
                    route.fromAmount,
                    route.toAmount,
                    route.targetExchange,
                    route.payload
                );
            }
            require(
                Utils.tokenBalance(address(_toToken), route.exchange) <=
                    initialExchangeToBalance,
                "Destination tokens are stuck in exchange"
            );
            require(
                Utils.tokenBalance(address(_fromToken), route.exchange) <=
                    initialExchangeFromBalance,
                "Source tokens are stuck in exchange"
            );
        }

        uint256 receivedAmount = Utils.tokenBalance(
            address(_toToken),
            address(this)
        );
        require(
            receivedAmount >= toAmount,
            "Received amount of tokens are less then expected tokens"
        );

        if (mintPrice > 0) {
            Utils.refundGas(
                address(_tokenTransferProxy),
                initialGas,
                mintPrice
            );
        }
        return receivedAmount;
    }

    function _takeFee(
        IERC20 toToken,
        uint256 receivedAmount,
        string memory referrer
    ) private returns (uint256) {
        address partnerContract = _partnerRegistry.getPartnerContract(referrer);

        //If there is no partner associated with the referral id then no fee will be taken
        if (partnerContract == address(0)) {
            return 0;
        }

        uint256 feePercent = IPartner(partnerContract).getFee();
        uint256 partnerSharePercent = IPartner(partnerContract)
            .getPartnerShare();
        address payable partnerFeeWallet = IPartner(partnerContract)
            .getFeeWallet();

        //Calculate total fee to be taken
        uint256 fee = receivedAmount.mul(feePercent).div(10000);
        //Calculate partner's share
        uint256 partnerShare = fee.mul(partnerSharePercent).div(10000);
        //All remaining fee is paraswap's share
        uint256 paraswapShare = fee.sub(partnerShare);

        Utils.transferTokens(address(toToken), partnerFeeWallet, partnerShare);
        Utils.transferTokens(address(toToken), _feeWallet, paraswapShare);

        emit FeeTaken(fee, partnerShare, paraswapShare);
        return fee;
    }
}
