pragma solidity ^0.5.4;

import "../exchange/TokenPriceProvider.sol";
import "../exchange/KyberNetwork.sol";

contract TokenPriceProviderTest is TokenPriceProvider {

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    KyberNetwork kyberNetworkContract;

    constructor(KyberNetwork _kyberNetwork) public {
        kyberNetworkContract = _kyberNetwork;
    }

    function syncPrice(ERC20 _token) external {
        _syncPrice(_token);
    }

    function syncPriceForTokenList(ERC20[] calldata _tokens) external {
        for(uint16 i = 0; i < _tokens.length; i++) {
            _syncPrice(_tokens[i]);
        }
    }

    //
    // Internal
    //

    function _syncPrice(ERC20 _token) internal {
        uint256 expectedRate;
        (expectedRate,) = kyberNetworkContract.getExpectedRate(_token, ERC20(ETH_TOKEN_ADDRESS), 10000);
        cachedPrices[address(_token)] = expectedRate;
    }
}
