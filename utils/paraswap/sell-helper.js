const web3Coder = require("web3-eth-abi");
const ethers = require("ethers");

const PARASWAP_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const ZERO_BYTES32 = ethers.constants.HashZero;

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
    takerAddress: ZERO_ADDRESS,
    feeRecipientAddress: ZERO_ADDRESS,
    senderAddress: ZERO_ADDRESS,
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
    taker: ZERO_ADDRESS,
    txOrigin: ZERO_ADDRESS,
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

const getUniswapRoutes = ({ fromToken, toToken }) => [{
  exchange: "uniswap",
  percent: "20",
  data: { tokenFrom: fromToken, tokenTo: toToken },
},
{
  exchange: "uniswapv2",
  percent: "20",
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
},
{
  exchange: "sushiswap",
  percent: "20",
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
},
{
  exchange: "linkswap",
  percent: "20",
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
},
{
  exchange: "defiswap",
  percent: "20",
  data: { tokenFrom: fromToken, tokenTo: toToken, path: [fromToken, toToken] },
},
];

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
    case "uniswapv2":
    case "sushiswap":
    case "linkswap":
    case "defiswap":
      return getUniswapRoutes({ fromToken, toToken });
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
  beneficiary = ZERO_ADDRESS,
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

module.exports = {
  getRouteParams,
  getParaswappoolData,
  getSimpleSwapParams,
  getRoutesForExchange
};
