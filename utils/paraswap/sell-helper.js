const web3Coder = require("web3-eth-abi");

const getTargetExchange = (tokenFrom, exchangeName, exchangeAddress, targetExchanges) => targetExchanges[exchangeName];

const getPayLoad = (fromToken, toToken, exchange, data) => {
  const { path, orders, order, signatures, signature } = data;
  switch (exchange.toLowerCase()) {
    case "uniswapv2":
    case "sushiswap":
    case "linkswap":
    case "defiswap":
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            path: "address[]",
          },
        },
        { path },
      );

    case "paraswappoolv4":
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            order: {
              makerToken: "address",
              takerToken: "address",
              makerAmount: "uint128",
              takerAmount: "uint128",
              maker: "address",
              taker: "address",
              txOrigin: "address",
              pool: "bytes32",
              expiry: "uint64",
              salt: "uint256",
            },
            signature: {
              signatureType: "uint256",
              v: "uint8",
              r: "bytes32",
              s: "bytes32",
            }
          }
        },
        {
          order,
          signature
        });
    case "paraswappoolv2":
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            "orders[]": {
              makerAddress: "address", // Address that created the order.
              takerAddress: "address", // Address that is allowed to fill the order. If set to 0, any address is allowed to fill the order.
              feeRecipientAddress: "address", // Address that will recieve fees when order is filled.
              senderAddress: "address", // Address that is allowed to call Exchange contract methods that affect this order. If set to 0, any address is allowed to call these methods.
              makerAssetAmount: "uint256", // Amount of makerAsset being offered by maker. Must be greater than 0.
              takerAssetAmount: "uint256", // Amount of takerAsset being bid on by maker. Must be greater than 0.
              makerFee: "uint256", // Fee paid to feeRecipient by maker when order is filled.
              takerFee: "uint256", // Fee paid to feeRecipient by taker when order is filled.
              expirationTimeSeconds: "uint256", // Timestamp in seconds at which order expires.
              salt: "uint256", // Arbitrary number to facilitate uniqueness of the order's hash.
              makerAssetData: "bytes", // Encoded data that can be decoded by a specified proxy contract when transferring makerAsset. The leading bytes4 references the id of the asset proxy.
              takerAssetData: "bytes"
            },
            signatures: "bytes[]"
          }
        },
        {
          orders,
          signatures
        }
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
