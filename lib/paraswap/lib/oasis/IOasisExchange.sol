pragma solidity ^0.5.4;


interface IOasisExchange {

    function sellAllAmount(
        address otc,
        address payToken,
        uint payAmt,
        address buyToken,
        uint minBuyAmt
    )
        external
        returns (uint buyAmt);

    function sellAllAmountPayEth(
        address otc,
        address wethToken,
        address buyToken,
        uint minBuyAmt
    )
        external
        payable
        returns (uint buyAmt);

    function sellAllAmountBuyEth(
        address otc,
        address payToken,
        uint payAmt,
        address wethToken,
        uint minBuyAmt
    )
        external
        returns (uint wethAmt);

     function createAndSellAllAmount(
        address factory,
        address otc,
        address payToken,
        uint payAmt,
        address buyToken,
        uint minBuyAmt
    )
        external
        returns (address proxy, uint buyAmt);

    function createAndSellAllAmountPayEth(
        address factory,
        address otc,
        address buyToken,
        uint minBuyAmt
    )
        external
        payable
        returns (address proxy, uint buyAmt);

    function createAndSellAllAmountBuyEth(
        address factory,
        address otc,
        address payToken,
        uint payAmt,
        uint minBuyAmt
    )
        external
        returns (address proxy, uint wethAmt);


    function buyAllAmount(
        address otc,
        address buyToken,
        uint buyAmt,
        address payToken,
        uint maxPayAmt
    )
        external
        returns (uint payAmt);

    function buyAllAmountPayEth(
        address otc,
        address buyToken,
        uint buyAmt,
        address wethToken
    )
        external
        payable
        returns (uint wethAmt);

    function buyAllAmountBuyEth(
        address otc,
        address wethToken,
        uint wethAmt,
        address payToken,
        uint maxPayAmt
    )
        external
        returns (uint payAmt);

    function createAndBuyAllAmount(
        address factory,
        address otc,
        address buyToken,
        uint buyAmt,
        address payToken,
        uint maxPayAmt
    )
      external
      returns (address proxy, uint payAmt);

    function createAndBuyAllAmountPayEth(
        address factory,
        address otc,
        address buyToken,
        uint buyAmt
    )
        external
        payable
        returns (address proxy, uint wethAmt);

    function createAndBuyAllAmountBuyEth(
        address factory,
        address otc,
        uint wethAmt,
        address payToken,
        uint maxPayAmt
    )
        external
        returns (address proxy, uint payAmt);


}
