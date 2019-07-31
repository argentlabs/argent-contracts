pragma solidity ^0.5.4;	

import "../exchange/TokenPriceProvider.sol";	
 
contract TokenPriceProviderTest is TokenPriceProvider {	
    KyberNetwork kyberNetworkContract;	
    
    constructor(KyberNetwork _kyberNetwork) public {	
        kyberNetworkContract = _kyberNetwork;	
    }	
    
    function _kyberNetwork() internal view returns (KyberNetwork) {	
        return kyberNetworkContract;	
    }	
}