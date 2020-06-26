const web3Coder = require("web3-eth-abi");

const getTargetExchange = (tokenFrom, exchangeName, exchangeAddress, targetExchanges) => targetExchanges[exchangeName];

const getPayLoad = (fromToken, toToken, exchange, data) => {
  const { path, minConversionRateForBuy } = data;

  switch (exchange.toLowerCase()) {
    case "uniswapv2":
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            path: "address[]",
          },
        },
        { path },
      );

    case "kyber":
      if (!minConversionRateForBuy) {
        return "0x";
      }
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            minConversionRateForBuy: "uint256",
          },
        },
        { minConversionRateForBuy },
      );

    default:
      return "0x";
  }
};


const getRouteParams = (srcToken, destToken, route, exchanges, targetExchanges) => {
  const exchangeName = route.exchange.toLowerCase();
  const networkFee = route.data.networkFee ? route.data.networkFee : 0;
  const payload = getPayLoad(
    srcToken,
    destToken,
    exchangeName,
    route.data,
  );
  const targetExchange = getTargetExchange(
    srcToken,
    exchangeName,
    route.data.exchange,
    targetExchanges,
  );
  return {
    exchange: exchanges[exchangeName],
    targetExchange,
    fromAmount: route.srcAmount,
    toAmount: route.destAmount,
    payload,
    networkFee,
  };
};

const makeRoutes = (srcToken, destToken, priceRoutes, exchanges, targetExchanges) => {
  const routes = priceRoutes.map((route) => getRouteParams(srcToken, destToken, route, exchanges, targetExchanges));
  return routes;
};


module.exports = {
  makeRoutes,
};
