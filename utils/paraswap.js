const web3Coder = require("web3-eth-abi");
const ethers = require("ethers");
const { assert, expect } = require("chai");
const utils = require("./utilities.js");

const PARASWAP_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_BYTES32 = ethers.constants.HashZero;
const UNIV3_FEE = 3000;

const getTargetExchange = (tokenFrom, exchangeName, exchangeAddress, targetExchanges) => targetExchanges[exchangeName];

const getPayLoad = (fromToken, toToken, exchange, data) => {
  const { path, orders, order, signatures, signature, fee } = data;
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
    case "uniswapv3":
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            fee: "uint24",
            deadline: "uint256",
            sqrtPriceLimitX96: "uint160"
          },
        },
        { fee, deadline: 2000000000, sqrtPriceLimitX96: 0 },
      );
    case "curve":
      return web3Coder.encodeParameter(
        {
          ParentStruct: {
            i: "int128",
            j: "int128",
            deadline: "uint256",
            underlyingSwap: "bool"
          }
        },
        { i: 0, j: 1, deadline: 4102444800, underlyingSwap: false }
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

const getParaswappoolV2Data = ({ maker }) => ({
  signatures: [],
  orders: [{
    makerAddress: maker,
    takerAddress: utils.ZERO_ADDRESS,
    feeRecipientAddress: utils.ZERO_ADDRESS,
    senderAddress: utils.ZERO_ADDRESS,
    makerAssetAmount: 0,
    takerAssetAmount: 0,
    makerFee: 0,
    takerFee: 0,
    expirationTimeSeconds: 0,
    salt: 0,
    makerAssetData: "0x",
    takerAssetData: "0x"
  }]
});

const getParaswappoolV4Data = ({ fromToken, toToken, maker }) => ({
  signature: { signatureType: 0, v: 0, r: ZERO_BYTES32, s: ZERO_BYTES32 },
  order: {
    makerToken: toToken,
    takerToken: fromToken,
    makerAmount: 0,
    takerAmount: 0,
    maker,
    taker: utils.ZERO_ADDRESS,
    txOrigin: utils.ZERO_ADDRESS,
    pool: ZERO_BYTES32,
    expiry: 0,
    salt: 0,
  }
});

const getParaswappoolData = ({ fromToken, toToken, maker, version = 2 }) => {
  if (version === 2) return getParaswappoolV2Data({ maker });
  return getParaswappoolV4Data({ fromToken, toToken, maker });
};

const getParaswappoolRoutes = ({ fromToken, toToken, maker }) => [{
  exchange: "paraswappoolv2",
  percent: "50",
  data: {
    tokenFrom: fromToken,
    tokenTo: toToken,
    ...getParaswappoolData({ maker, version: 2 })
  },
}, {
  exchange: "paraswappoolv4",
  percent: "50",
  data: {
    tokenFrom: fromToken,
    tokenTo: toToken,
    ...getParaswappoolData({ fromToken, toToken, maker, version: 4 })
  }
}];

const getUniswapRoutes = ({ fromToken, toToken, percent = "100" }) => [{
  exchange: "uniswap",
  percent,
  data: { tokenFrom: fromToken, tokenTo: toToken },
}];

const getUniswapV2Routes = ({ fromToken, toToken, percent = "100" }) => [{
  exchange: "uniswapv2",
  percent,
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
}];

const getSushiswapRoutes = ({ fromToken, toToken, percent = "100" }) => [{
  exchange: "sushiswap",
  percent,
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
}];

const getLinkswapRoutes = ({ fromToken, toToken, percent = "100" }) => [{
  exchange: "linkswap",
  percent,
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
}];

const getDefiswapRoutes = ({ fromToken, toToken, percent = "100" }) => [{
  exchange: "defiswap",
  percent,
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
}];

const getCurveRoutes = ({ fromToken, toToken }) => [{
  exchange: "curve",
  percent: "100",
  data: { tokenFrom: fromToken, tokenTo: toToken },
}];

const getWethRoutes = ({ fromToken, toToken }) => [{
  exchange: "weth",
  percent: "100",
  data: { tokenFrom: fromToken, tokenTo: toToken },
}];

const getUniV3Routes = ({ fromToken, toToken, fee }) => [{
  exchange: "uniswapV3",
  percent: "100",
  data: { tokenFrom: fromToken, tokenTo: toToken, fee },
}];

const getRoutesForExchange = ({ fromToken, toToken, maker, fee, exchange }) => {
  switch (exchange) {
    case "paraswappoolv2":
    case "paraswappoolv4":
      return getParaswappoolRoutes({ fromToken, toToken, maker });
    case "uniswap":
      return getUniswapRoutes({ fromToken, toToken });
    case "uniswapv2":
      return getUniswapV2Routes({ fromToken, toToken });
    case "sushiswap":
      return getSushiswapRoutes({ fromToken, toToken });
    case "linkswap":
      return getLinkswapRoutes({ fromToken, toToken });
    case "defiswap":
      return getDefiswapRoutes({ fromToken, toToken });
    case "uniswapLike":
      return [
        getUniswapRoutes({ fromToken, toToken, percent: "20" }),
        getUniswapV2Routes({ fromToken, toToken, percent: "20" }),
        getSushiswapRoutes({ fromToken, toToken, percent: "20" }),
        getLinkswapRoutes({ fromToken, toToken, percent: "20" }),
        getDefiswapRoutes({ fromToken, toToken, percent: "20" }),
      ].flat();
    case "curve":
      return getCurveRoutes({ fromToken, toToken });
    case "weth":
      return getWethRoutes({ fromToken, toToken });
    case "uniswapV3":
      return getUniV3Routes({ fromToken, toToken, fee });
    default:
      throw new Error(`unknown exchange "${exchange}"`);
  }
};

function getSimpleSwapParams({
  targetExchange, swapMethod, swapParams,
  fromTokenContract = { address: PARASWAP_ETH_TOKEN }, toTokenContract = { address: PARASWAP_ETH_TOKEN },
  proxy = null,
  fromAmount = 1, toAmount = 1,
  beneficiary = utils.ZERO_ADDRESS,
  convertWeth = false,
  augustus = null,
  weth = null
}) {
  let exchangeData = "0x";
  const callees = [];
  const startIndexes = [];
  const values = [];

  startIndexes.push(0);
  if (fromTokenContract.address !== PARASWAP_ETH_TOKEN && targetExchange !== fromTokenContract) {
    callees.push(fromTokenContract.address);
    values.push(0, 0);
    exchangeData += fromTokenContract.contract.methods.approve((proxy || targetExchange).address, fromAmount).encodeABI().slice(2);
    startIndexes.push(exchangeData.length / 2 - 1);
  } else {
    values.push(fromAmount);
  }

  callees.push(targetExchange.address);
  if (swapMethod) {
    exchangeData += targetExchange.contract.methods[swapMethod](...(swapParams || [])).encodeABI().slice(2);
  }
  startIndexes.push(exchangeData.length / 2 - 1);

  if (convertWeth) {
    if (!augustus) throw new Error("convertWeth=true requires non-null augustus");
    if (!weth) throw new Error("convertWeth=true requires non-null weth");
    callees.push(augustus.address);
    values.push(0);
    exchangeData += augustus.contract.methods.withdrawAllWETH(weth.address).encodeABI().slice(2);
    startIndexes.push(exchangeData.length / 2 - 1);
  }

  return [
    fromTokenContract.address, toTokenContract.address,
    fromAmount, toAmount,
    0, callees, exchangeData, startIndexes, values,
    beneficiary, "abc", false
  ];
}

const makeParaswapHelpers = ({
  argent,
  wallet,
  tokens,
  paraswap,
  paraswapProxy,
  unauthorisedAdapter,
  adapterAddresses,
  targetExchangeAddresses,
  exchangeContracts,
  uniswapForkData,
  uniswapV1Factory,
  zeroExV2Proxy,
  marketMaker,
  other,
}) => {
  const { module, manager, owner, relayer } = argent;
  const { tokenA, tokenB, tokenC } = tokens;
  const {
    paraswapUniV2Router, uniswapV3Router, uniswapV1Exchanges, zeroExV2TargetExchange, zeroExV4TargetExchange, curvePool, weth
  } = exchangeContracts;

  function getTokenContract(tokenAddress) {
    if (tokenAddress === tokenA.address) {
      return tokenA;
    }
    if (tokenAddress === tokenB.address) {
      return tokenB;
    }
    if (tokenAddress === tokenC.address) {
      return tokenC;
    }
    if (tokenAddress === weth.address) {
      return weth;
    }
    return { address: PARASWAP_ETH_TOKEN };
  }

  async function getBalance(tokenAddress, _wallet) {
    if (tokenAddress === PARASWAP_ETH_TOKEN) {
      return utils.getBalance(_wallet.address);
    }
    return getTokenContract(tokenAddress).balanceOf(_wallet.address);
  }

  const multiCall = async (transactions, { errorReason = null }) => {
    const receipt = await manager.relay(
      module, "multiCall", [wallet.address, transactions], wallet, [owner], 0, utils.ETH_TOKEN, relayer
    );
    const { success, error } = utils.parseRelayReceipt(receipt);
    if (errorReason) {
      assert.isFalse(success, "multiCall should have failed");
      assert.equal(error, errorReason);
    } else {
      assert.isTrue(success, `multiCall failed: "${error}"`);
    }
  };

  function getPath({ fromToken, toToken, routes, useUnauthorisedAdapter = false, useUnauthorisedTargetExchange = false }) {
    const exchanges = {
      uniswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.uniswap,
      uniswapv2: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.uniswapV2,
      uniswapv3: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.uniswapV3,
      sushiswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.sushiswap,
      linkswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.linkswap,
      defiswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.defiswap,
      paraswappoolv2: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.zeroexV2,
      paraswappoolv4: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.zeroexV4,
      curve: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.curve,
      weth: useUnauthorisedAdapter ? unauthorisedAdapter.address : adapterAddresses.weth,
    };
    const targetExchanges = {
      uniswap: useUnauthorisedTargetExchange ? other : uniswapV1Factory.address,
      uniswapv2: utils.ZERO_ADDRESS,
      uniswapv3: useUnauthorisedTargetExchange ? other : uniswapV3Router.address,
      sushiswap: utils.ZERO_ADDRESS,
      linkswap: utils.ZERO_ADDRESS,
      defiswap: utils.ZERO_ADDRESS,
      paraswappoolv2: useUnauthorisedTargetExchange ? other : targetExchangeAddresses.zeroexV2,
      paraswappoolv4: useUnauthorisedTargetExchange ? other : targetExchangeAddresses.zeroexV4,
      curve: useUnauthorisedTargetExchange ? other : targetExchangeAddresses.curve[0],
      weth: utils.ZERO_ADDRESS
    };
    return [{
      to: toToken,
      totalNetworkFee: 0,
      routes: routes.map((route) => getRouteParams(fromToken, toToken, route, exchanges, targetExchanges)),
    }];
  }

  function getMultiSwapData({
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    beneficiary,
    useUnauthorisedAdapter = false,
    useUnauthorisedTargetExchange = false,
    routes
  }) {
    const path = getPath({ fromToken, toToken, routes, useUnauthorisedAdapter, useUnauthorisedTargetExchange });
    return paraswap.contract.methods.multiSwap({
      fromToken, fromAmount, toAmount, expectedAmount: 0, beneficiary, referrer: "abc", useReduxToken: false, path
    }).encodeABI();
  }

  function getMegaSwapData({
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    beneficiary,
    useUnauthorisedAdapter,
    useUnauthorisedTargetExchange,
    routes
  }) {
    const path = getPath({ fromToken, toToken, routes, useUnauthorisedAdapter, useUnauthorisedTargetExchange });
    return paraswap.contract.methods.megaSwap({
      fromToken,
      fromAmount,
      toAmount,
      expectedAmount: 0,
      beneficiary,
      referrer: "abc",
      useReduxToken: false,
      path: [{ fromAmountPercent: 10000, path }]
    }).encodeABI();
  }

  function getSimpleSwapExchangeCallParams({ exchange, fromToken, toToken, fromAmount, toAmount, maker }) {
    let targetExchange;
    let swapMethod;
    let swapParams;
    let proxy = null;
    let convertWeth = false;

    if (exchange === "uniswapv2") {
      targetExchange = paraswapUniV2Router;
      swapMethod = "swap";
      swapParams = [fromAmount, toAmount, [fromToken, toToken]];
    } else if (exchange === "uniswapv3") {
      targetExchange = uniswapV3Router;
      swapMethod = "exactInputSingle";
      swapParams = [{
        tokenIn: fromToken,
        tokenOut: toToken,
        fee: UNIV3_FEE,
        recipient: paraswap.address,
        deadline: 99999999999,
        amountIn: fromAmount,
        amountOutMinimum: toAmount,
        sqrtPriceLimitX96: 0
      }];
    } else if (exchange === "uniswap" || exchange === "uniswapLike") {
      if (fromToken === PARASWAP_ETH_TOKEN) {
        targetExchange = uniswapV1Exchanges[toToken];
        swapMethod = "ethToTokenSwapInput";
        swapParams = [1, 99999999999];
      } else {
        targetExchange = uniswapV1Exchanges[fromToken];
        if (toToken === PARASWAP_ETH_TOKEN) {
          swapMethod = "tokenToEthSwapInput";
          swapParams = [fromAmount, 1, 99999999999];
        } else {
          swapMethod = "tokenToTokenSwapInput";
          swapParams = [fromAmount, 1, 1, 99999999999, toToken];
        }
      }
    } else if (exchange === "zeroexv2") {
      proxy = zeroExV2Proxy;
      targetExchange = zeroExV2TargetExchange;
      swapMethod = "marketSellOrdersNoThrow";
      const { orders, signatures } = getParaswappoolData({ maker, version: 2 });
      swapParams = [orders, 0, signatures];
      convertWeth = toToken === PARASWAP_ETH_TOKEN;
    } else if (exchange === "zeroexv4") {
      targetExchange = zeroExV4TargetExchange;
      swapMethod = "fillRfqOrder";
      convertWeth = toToken === PARASWAP_ETH_TOKEN;
      const { order, signature } = getParaswappoolData({ fromToken, toToken, maker, version: 4 });
      swapParams = [order, signature, 0];
    } else if (exchange === "curve") {
      targetExchange = curvePool;
      swapMethod = "exchange";
      swapParams = [0, 1, fromAmount, toAmount];
    } else if (exchange === "weth") {
      targetExchange = weth;
      swapMethod = fromToken === PARASWAP_ETH_TOKEN ? "deposit" : "withdraw";
      swapParams = fromToken === PARASWAP_ETH_TOKEN ? [] : [toAmount];
    }

    return { targetExchange, swapMethod, swapParams, proxy, convertWeth, augustus: paraswap, weth };
  }

  function getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, exchange, beneficiary, maker = marketMaker }) {
    const simpleSwapParams = getSimpleSwapParams({
      ...getSimpleSwapExchangeCallParams({ exchange, fromToken, toToken, fromAmount, toAmount, maker }),
      fromTokenContract: getTokenContract(fromToken),
      toTokenContract: getTokenContract(toToken),
      fromAmount,
      toAmount,
      beneficiary
    });
    return paraswap.contract.methods.simpleSwap(...simpleSwapParams).encodeABI();
  }

  function getSwapOnUniswapData({ fromToken, toToken, fromAmount, toAmount }) {
    return paraswap.contract.methods.swapOnUniswap(fromAmount, toAmount, [fromToken, toToken], 0).encodeABI();
  }

  function getSwapOnUniswapForkData({ fromToken, toToken, fromAmount, toAmount }) {
    return paraswap.contract.methods.swapOnUniswapFork(
      uniswapForkData.factory, uniswapForkData.initCode, fromAmount, toAmount, [fromToken, toToken], 0
    ).encodeABI();
  }

  async function testTrade({
    method,
    fromToken,
    toToken,
    beneficiary = utils.ZERO_ADDRESS,
    fromAmount = web3.utils.toWei("0.01"),
    toAmount = 1,
    useUnauthorisedAdapter = false,
    useUnauthorisedTargetExchange = false,
    errorReason = null,
    exchange = "uniswapLike"
  }) {
    const beforeFrom = await getBalance(fromToken, wallet);
    const beforeTo = await getBalance(toToken, wallet);
    expect(beforeFrom).to.be.gte.BN(fromAmount); // wallet should have enough of fromToken
    const transactions = [];

    // token approval if necessary
    if (fromToken !== PARASWAP_ETH_TOKEN) {
      const token = getTokenContract(fromToken);
      const approveData = token.contract.methods.approve(paraswapProxy, fromAmount).encodeABI();
      transactions.push(utils.encodeTransaction(fromToken, 0, approveData));
    }

    // token swap
    let swapData;
    const routes = getRoutesForExchange({ fromToken, toToken, maker: marketMaker, exchange });
    if (method === "multiSwap") {
      swapData = getMultiSwapData({
        fromToken, toToken, fromAmount, toAmount, beneficiary, routes, useUnauthorisedAdapter, useUnauthorisedTargetExchange
      });
    } else if (method === "megaSwap") {
      swapData = getMegaSwapData({
        fromToken, toToken, fromAmount, toAmount, beneficiary, routes, useUnauthorisedAdapter, useUnauthorisedTargetExchange
      });
    } else if (method === "simpleSwap") {
      swapData = getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary, exchange });
    } else if (method === "swapOnUniswap") {
      swapData = getSwapOnUniswapData({ fromToken, toToken, fromAmount, toAmount });
    } else if (method === "swapOnUniswapFork") {
      swapData = getSwapOnUniswapForkData({ fromToken, toToken, fromAmount, toAmount });
    } else {
      throw new Error("Invalid method");
    }
    const value = fromToken === PARASWAP_ETH_TOKEN ? fromAmount : 0;
    transactions.push(utils.encodeTransaction(paraswap.address, value, swapData));

    await multiCall(transactions, { errorReason });
    if (!errorReason) {
      const afterFrom = await getBalance(fromToken, wallet);
      const afterTo = await getBalance(toToken, wallet);
      expect(beforeFrom).to.be.gt.BN(afterFrom);
      expect(afterTo).to.be.gt.BN(beforeTo);
    }
  }

  return { testTrade, multiCall, getSimpleSwapData, getMultiSwapData, getSimpleSwapExchangeCallParams };
};

module.exports = {
  getRouteParams,
  getParaswappoolData,
  getSimpleSwapParams,
  getRoutesForExchange,
  makeParaswapHelpers,
};
