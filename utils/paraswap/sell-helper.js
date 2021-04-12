const web3Coder = require("web3-eth-abi");

const getTargetExchange = (tokenFrom, exchangeName, exchangeAddress, targetExchanges) => targetExchanges[exchangeName];

const getPayLoad = (fromToken, toToken, exchange, data) => {
  const { path } = data;
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

    default:
      return "0x";
  }
};

const getRouteParams = (srcToken, destToken, route, exchanges, targetExchanges) => {
  const exchangeName = route.exchange.toLowerCase();
  const networkFee = route.data.networkFee ? route.data.networkFee : 0;
  const payload = getPayLoad(srcToken, destToken, exchangeName, route.data, networkFee);
  const targetExchange = getTargetExchange(srcToken, exchangeName, route.data.exchange, targetExchanges);
  return {
    exchange: exchanges[exchangeName],
    targetExchange,
    percent: Number(route.percent) * 100,
    payload,
    networkFee,
  };
};

const makePathes = (srcToken, destToken, priceRoute, exchanges, targetExchanges, isMultiPath) => {
  if (isMultiPath) {
    return priceRoute.map((_routes) => {
      const { tokenFrom, tokenTo } = _routes[0].data;
      const routes = _routes.map((route) => getRouteParams(tokenFrom, tokenTo, route, exchanges, targetExchanges));
      let totalNetworkFee = 0;
      for (let i = 0; i < routes.length; i += 1) {
        totalNetworkFee += Number(routes[i].networkFee);
      }
      return {
        to: tokenTo,
        totalNetworkFee,
        routes,
      };
    });
  }

  return priceRoute.map((route) => ({
    to: destToken,
    totalNetworkFee: route.data.networkFee ? route.data.networkFee : 0,
    routes: [getRouteParams(srcToken, destToken, route, exchanges, targetExchanges)],
  }));
};

module.exports = {
  makePathes,
  getRouteParams
};
