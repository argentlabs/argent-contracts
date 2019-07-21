pragma solidity ^0.5.4;

interface UniswapFactory {
    function getExchange(address _token) external view returns(address);
}

interface UniswapExchange {
    function getEthToTokenOutputPrice(uint256 _tokens_bought) external view returns (uint256);
    function getEthToTokenInputPrice(uint256 _eth_sold) external view returns (uint256);
    function getTokenToEthOutputPrice(uint256 _eth_bought) external view returns (uint256);
    function getTokenToEthInputPrice(uint256 _tokens_sold) external view returns (uint256);
}
