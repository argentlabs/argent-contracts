pragma solidity 0.7.5;

interface IUniswapExchange {
    function ethToTokenSwapInput(
        uint256 minTokens,
        uint256 deadline) external payable returns (uint256 tokensBought);

     function ethToTokenSwapOutput(
        uint256 tokensBought,
        uint256 deadline) external payable returns (uint256 ethSold);

    function tokenToEthSwapInput(
        uint256 tokensSold,
        uint256 minEth,
        uint256 deadline) external returns (uint256 ethBought);

    function tokenToEthSwapOutput(
        uint256 ethBought,
        uint256 maxTokens,
        uint256 deadline) external returns (uint256 tokensSold);

    function tokenToTokenSwapInput(
        uint256 tokensSold,
        uint256 minTokensBought,
        uint256 minEthBought,
        uint256 deadline,
        address tokenAddr
    ) external returns (uint256 tokensBought);

    function tokenToTokenSwapOutput(
        uint256 tokensBought,
        uint256 maxTokensSold,
        uint256 maxEthSold,
        uint256 deadline,
        address toToken
    ) external returns (uint256 tokensSold);

    function ethToTokenTransferInput(
        uint256 min_tokens,
        uint256 deadline,
        address recipient
    ) external payable returns (uint256 tokens_bought);

    function ethToTokenTransferOutput(
        uint256 tokens_bought,
        uint256 deadline,
        address recipient
    ) external payable returns (uint256 eth_sold);

    function tokenToEthTransferInput(
        uint256 tokens_sold,
        uint256 min_tokens,
        uint256 deadline,
        address recipient
    ) external returns (uint256 eth_bought);

    function tokenToEthTransferOutput(
        uint256 eth_bought,
        uint256 max_tokens,
        uint256 deadline,
        address recipient
    ) external returns (uint256 tokens_sold);

    function tokenToTokenTransferInput(
        uint256 tokens_sold,
        uint256 min_tokens_bought,
        uint256 min_eth_bought,
        uint256 deadline,
        address recipient,
        address token_addr
    ) external returns (uint256 tokens_bought);

    function tokenToTokenTransferOutput(
        uint256 tokens_bought,
        uint256 max_tokens_sold,
        uint256 max_eth_sold,
        uint256 deadline,
        address recipient,
        address token_addr
    ) external returns (uint256 tokens_sold);
}
