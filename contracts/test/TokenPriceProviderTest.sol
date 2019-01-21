pragma solidity ^0.4.24;	

import "../exchange/TokenPriceProvider.sol";	
 
contract TokenPriceProviderTest is TokenPriceProvider {	
    KyberNetwork kyberNetworkContract;	
    
    constructor(KyberNetwork _kyberNetwork) public {	
        kyberNetworkContract = _kyberNetwork;	
    }	
    
    function kyberNetwork() internal view returns (KyberNetwork) {	
        return kyberNetworkContract;	
    }	
}