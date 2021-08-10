/* global artifacts */

const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const { getSimpleSwapParams, getRoutesForExchange } = require("../utils/paraswap/sell-helper");
const utils = require("../utils/utilities.js");
const { makeParaswapHelpers } = require("../utils/paraswap/swap-helper.js");

const IAugustusSwapper = artifacts.require("IAugustusSwapper");
const ZeroxV2TargetExchange = artifacts.require("ZeroxV2TargetExchangeMock");
const ZeroxV4TargetExchange = artifacts.require("ZeroxV4TargetExchangeMock");
const CurvePool = artifacts.require("CurvePoolMock");

const Uniswap = artifacts.require("Uniswap");
const UniswapV3Router = artifacts.require("SwapRouter");
const UniswapExchange = artifacts.require("UniswapExchange");
const ParaswapFilter = artifacts.require("ParaswapFilter");
const ParaswapUniV2RouterFilter = artifacts.require("ParaswapUniV2RouterFilter");
const ParaswapUniswapV2Router = artifacts.require("UniswapV3Router");
const UniswapV3RouterFilter = artifacts.require("UniswapV3RouterFilter");
const ZeroExV2Filter = artifacts.require("WhitelistedZeroExV2Filter");
const ZeroExV4Filter = artifacts.require("WhitelistedZeroExV4Filter");
const CurveFilter = artifacts.require("CurveFilter");
const WethFilter = artifacts.require("WethFilter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const TokenRegistry = artifacts.require("TokenRegistry");
const ERC20 = artifacts.require("TestERC20");

const UNIV3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNIV3_INIT_CODE = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
const UNIV3_FEE = 3000;
const DAI_WETH_UNIV3_PAIR = "0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8";
const USDC_WETH_UNIV3_PAIR = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const DAI_USDC_UNIV3_PAIR = "0xa63b490aA077f541c9d64bFc1Cc0db2a752157b5";

// UniV2
const DAI_WETH_UNIV2_PAIR = "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11";
const USDC_WETH_UNIV2_PAIR = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const DAI_USDC_UNIV2_PAIR = "0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5";
const UNIV2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const UNIV2_INIT_CODE = "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f";

// Sushi
const DAI_WETH_SUSHI_PAIR = "0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f";
const USDC_WETH_SUSHI_PAIR = "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0";
const DAI_USDC_SUSHI_PAIR = "0xAaF5110db6e744ff70fB339DE037B990A20bdace";

// UniV1
const UNIV1_FACTORY = "0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95";
const UNIV1_DAI_ETH_POOL = "0x2a1530C4C41db0B0b2bB646CB5Eb1A67b7158667";
const UNIV1_USDC_ETH_POOL = "0x97deC872013f6B5fB443861090ad931542878126";
const UNIV1_ETHMOON_ETH_POOL = "0x0D4b73d58869f5c33f267d3401204489874f8968";

// Paraswap
const PARASWAP_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const AUGUSTUS = "0x1bD435F3C054b6e901B7b108a0ab7617C808677b";
const UNISWAP_PROXY = "0x0fcbb36ed7908bd5952ca171584b74bbab283091";
const UNIV2_FORKS = [
  {
    factory: "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac",
    initCode: "0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303",
    paraswapUniV2Router: "0xBc1315CD2671BC498fDAb42aE1214068003DC51e",
  },
  {
    factory: "0x696708db871b77355d6c2be7290b27cf0bb9b24b",
    initCode: "0x50955d9250740335afc702786778ebeae56a5225e4e18b7cb046e61437cde6b3",
    paraswapUniV2Router: "0xEC4c8110E5B5Bf0ad8aa89e3371d9C3b8CdCD778",
  },
  {
    factory: "0x9deb29c9a4c7a88a3c0257393b7f3335338d9a9d",
    initCode: "0x69d637e77615df9f235f642acebbdad8963ef35c5523142078c9b8f9d0ceba7e",
    paraswapUniV2Router: "0xF806F9972F9A34FC05394cA6CF2cc606297Ca6D5",
  },
];
const ADAPTERS = {
  uniswap: "0x60b64533b9a1865d88758b05b6adfe60426311f2",
  uniswapV2: "0x695725627E04898Ef4a126Ae71FC30aA935c5fb6",
  sushiswap: "0x77Bc1A1ba4E9A6DF5BDB21f2bBC07B9854E8D1a8",
  linkswap: "0x28c4106aadd12a9bb5d795ae717d8aa0b5685277",
  defiswap: "0xdF68D5E9b413075Ff9654fdaBc7c6Ca72f72cfA3",
  zeroexV2: "0xae0eEa652303D174E267e4D51F656254d3039F76",
  zeroexV4: "0x64c3fb89f934592a2d7a5d1aa87c504b4bffe428",
  curve: "0x7B566Ec2B0f914e03e508EA2AE591ea2FaCF713A",
  weth: "0x19C95e4d0bddC5d252d84c2263F81FE1059B7368",
  uniswapV3: "0xbfBFf2938E3bE0fE588FbF6007F1fdE73C5a9A4E",
};
const TARGET_EXCHANGES = {
  uniswap: "0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95",
  uniswapV2: "0x86d3579b043585A97532514016dCF0C2d6C4b6a1",
  uniswapV3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  sushiswap: "0xBc1315CD2671BC498fDAb42aE1214068003DC51e",
  linkswap: "0xEC4c8110E5B5Bf0ad8aa89e3371d9C3b8CdCD778",
  defiswap: "0xF806F9972F9A34FC05394cA6CF2cc606297Ca6D5",
  zeroexV2: "0x080bf510fcbf18b91105470639e9561022937712",
  zeroexV4: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  curve: ["0x79a8c46dea5ada233abaffd40f3a0a2b1e5a4f27"],
};
const MARKET_MAKERS = ["0x56178a0d5f301baf6cf3e1cd53d9863437345bf9"];
const ZEROEXV2_PROXY = "0x95e6f48254609a6ee006f7d493c8e5fb97094cef";
const PARASWAP_OWNER = "0xe6B692dcC972b9a5C3C414ac75dDc420B9eDC92d";
const ETHMOON_TOKEN = "0x5dcfa62f81b43ce7a3632454d327dee1f1d93b28";

const { ZERO_ADDRESS, encodeTransaction, encodeCalls } = utils;

contract("Paraswap Filter", (accounts) => {
  let argent;
  let wallet;

  const other = accounts[3];
  const marketMaker = MARKET_MAKERS[0];

  let uniswapV1Exchanges;
  let uniswapV3Router;
  let zeroExV2TargetExchange;
  let zeroExV4TargetExchange;
  let curvePool;
  let unauthorisedAdapter;
  let weth;
  let tokenA;
  let tokenB;
  let tokenC;
  let paraswap;
  let paraswapProxy;
  let paraswapFilter;
  let tokenRegistry;
  let paraswapUniV2Router;

  let testTrade;
  let multiCall;
  let getSimpleSwapData;
  let getMultiSwapData;
  let getSimpleSwapExchangeCallParams;

  before(async () => {
    argent = await new ArgentContext(accounts).initialise();

    tokenA = argent.DAI;
    tokenB = argent.USDC;
    tokenC = await ERC20.at(ETHMOON_TOKEN);
    weth = argent.WETH;

    paraswap = await IAugustusSwapper.at(AUGUSTUS);
    paraswapProxy = await paraswap.getTokenTransferProxy();

    zeroExV2TargetExchange = await ZeroxV2TargetExchange.at(TARGET_EXCHANGES.zeroexV2);
    zeroExV4TargetExchange = await ZeroxV4TargetExchange.at(TARGET_EXCHANGES.zeroexV4);
    paraswapUniV2Router = await ParaswapUniswapV2Router.at(TARGET_EXCHANGES.uniswapV2);
    uniswapV1Exchanges = {
      [tokenA.address]: await UniswapExchange.at(UNIV1_DAI_ETH_POOL),
      [tokenB.address]: await UniswapExchange.at(UNIV1_USDC_ETH_POOL),
      [tokenC.address]: await UniswapExchange.at(UNIV1_ETHMOON_ETH_POOL),
    };
    uniswapV3Router = await UniswapV3Router.at(TARGET_EXCHANGES.uniswapV3);
    curvePool = await CurvePool.at(TARGET_EXCHANGES.curve[0]);
    unauthorisedAdapter = await Uniswap.new();

    tokenRegistry = await TokenRegistry.new();
    const pairs = [
      DAI_USDC_UNIV3_PAIR,
      USDC_WETH_UNIV3_PAIR,
      DAI_WETH_UNIV3_PAIR,
      DAI_USDC_UNIV2_PAIR,
      USDC_WETH_UNIV2_PAIR,
      DAI_WETH_UNIV2_PAIR,
      DAI_WETH_SUSHI_PAIR,
      USDC_WETH_SUSHI_PAIR,
      DAI_USDC_SUSHI_PAIR,
      UNIV1_DAI_ETH_POOL,
      UNIV1_USDC_ETH_POOL,
    ];
    await tokenRegistry.setTradableForTokenList([tokenA.address, tokenB.address, weth.address, ...pairs], Array(3 + pairs.length).fill(true));

    paraswapFilter = await ParaswapFilter.new(
      tokenRegistry.address,
      argent.dappRegistry.address,
      AUGUSTUS,
      UNISWAP_PROXY,
      [UNIV2_FORKS[0].factory, UNIV2_FORKS[0].factory, UNIV2_FORKS[0].factory, UNIV3_FACTORY],
      [UNIV2_FORKS[0].initCode, UNIV2_FORKS[0].initCode, UNIV2_FORKS[0].initCode, UNIV3_INIT_CODE],
      [
        ADAPTERS.uniswap,
        ADAPTERS.uniswapV2,
        ADAPTERS.sushiswap,
        ADAPTERS.linkswap,
        ADAPTERS.defiswap,
        ADAPTERS.zeroexV2,
        ADAPTERS.zeroexV4,
        ADAPTERS.curve,
        ADAPTERS.weth,
        ADAPTERS.uniswapV3,
      ],
      [].concat(...Object.values(TARGET_EXCHANGES)),
      MARKET_MAKERS
    );

    const proxyFilter = await OnlyApproveFilter.new();
    const paraswapUniV2RouterFilter = await ParaswapUniV2RouterFilter.new(tokenRegistry.address, UNIV2_FACTORY, UNIV2_INIT_CODE, argent.WETH.address);
    const uniV3RouterFilter = await UniswapV3RouterFilter.new(tokenRegistry.address, UNIV3_FACTORY, UNIV3_INIT_CODE, argent.WETH.address);
    const zeroExV2Filter = await ZeroExV2Filter.new(MARKET_MAKERS);
    const zeroExV4Filter = await ZeroExV4Filter.new(MARKET_MAKERS);
    const curveFilter = await CurveFilter.new();
    const wethFilter = await WethFilter.new();

    const paraswapProxyAddress = await paraswap.getTokenTransferProxy();
    await argent.dappRegistry.addDapp(0, paraswapProxyAddress, proxyFilter.address);
    await argent.dappRegistry.addDapp(0, AUGUSTUS, paraswapFilter.address);
    await argent.dappRegistry.addDapp(0, ZEROEXV2_PROXY, proxyFilter.address);
    await argent.dappRegistry.addDapp(0, TARGET_EXCHANGES.uniswapV2, paraswapUniV2RouterFilter.address);
    await argent.dappRegistry.addDapp(0, TARGET_EXCHANGES.uniswapV3, uniV3RouterFilter.address);
    await argent.dappRegistry.addDapp(0, TARGET_EXCHANGES.zeroexV2, zeroExV2Filter.address);
    await argent.dappRegistry.addDapp(0, TARGET_EXCHANGES.zeroexV4, zeroExV4Filter.address);
    await argent.dappRegistry.addDapp(0, TARGET_EXCHANGES.curve[0], curveFilter.address);
    await argent.dappRegistry.addDapp(0, argent.WETH.address, wethFilter.address);
    await argent.dappRegistry.addDapp(0, uniswapV1Exchanges[argent.DAI.address].address, ZERO_ADDRESS);
    await argent.dappRegistry.addDapp(0, uniswapV1Exchanges[argent.USDC.address].address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({
      ETH: web3.utils.toWei("1"),
      DAI: web3.utils.toWei("1000"),
      USDC: web3.utils.toWei("1000"), // wrong but needed to work without changing amounts
    });

    ({ testTrade, multiCall, getSimpleSwapData, getMultiSwapData, getSimpleSwapExchangeCallParams } = makeParaswapHelpers({
      argent,
      wallet,
      tokens: { tokenA, tokenB, tokenC },
      paraswap,
      paraswapProxy,
      unauthorisedAdapter,
      adapterAddresses: ADAPTERS,
      targetExchangeAddresses: TARGET_EXCHANGES,
      exchangeContracts: {
        paraswapUniV2Router, uniswapV3Router, uniswapV1Exchanges, zeroExV2TargetExchange, zeroExV4TargetExchange, curvePool, weth
      },
      uniswapForkData: UNIV2_FORKS[0],
      uniswapV1Factory: { address: UNIV1_FACTORY },
      zeroExV2Proxy: { address: ZEROEXV2_PROXY },
      marketMaker,
      other,
    }));
  });

  function testsForMethod(method) {
    const exchange = "uniswap";

    describe(`${method} trades`, () => {
      it("should sell ETH for DAI", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, exchange });
      });

      it("should sell USDC for ETH", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: PARASWAP_ETH_TOKEN, exchange });
      });

      it("should sell USDC for DAI", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: tokenA.address, exchange });
      });

      it("should not sell ETH for non-tradable token C", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenC.address, exchange, errorReason: "TM: call not authorised" });
      });
    });
  }

  ["multiSwap", "swapOnUniswap", "swapOnUniswapFork", "megaSwap"].forEach(testsForMethod);

  it("performs a multiswap weth->eth trade", async () => {
    const fromAmount = web3.utils.toWei("0.01");
    await weth.deposit({ value: fromAmount });
    await weth.transfer(wallet.address, fromAmount);
    await testTrade({ method: "multiSwap", fromAmount, fromToken: weth.address, toToken: PARASWAP_ETH_TOKEN, exchange: "weth" });
  });

  it("performs a multiswap eth->weth trade", async () => {
    const fromAmount = web3.utils.toWei("0.01");
    await testTrade({ method: "multiSwap", fromAmount, fromToken: PARASWAP_ETH_TOKEN, toToken: weth.address, exchange: "weth" });
  });

  function testSimpleSwapTradesViaExchange(exchange) {
    const method = "simpleSwap";

    describe(`simpleSwap trades via ${exchange}`, () => {
      it("should sell ETH for DAI", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, exchange });
      });

      it("should sell USDC for ETH", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: PARASWAP_ETH_TOKEN, exchange });
      });

      it("should sell USDC for DAI", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: tokenA.address, exchange });
      });

      it("should not sell ETH for non-tradable token C", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenC.address, errorReason: "TM: call not authorised", exchange });
      });
    });
  }

  ["uniswap", "uniswapv2"].forEach(testSimpleSwapTradesViaExchange);

  describe("unauthorised access", () => {
    it("should not allow sending ETH without calling an authorised method", async () => {
      await multiCall([encodeTransaction(paraswap.address, web3.utils.toWei("0.01"), "0x")],
        { errorReason: "TM: call not authorised" });
    });

    it("should not allow unsupported method call", async () => {
      await multiCall(encodeCalls([[paraswap, "getFeeWallet"]]),
        { errorReason: "TM: call not authorised" });
    });

    it("should not allow swapOnUniswap[Fork] via unauthorised uniswap proxy", async () => {
      const timelock = (await paraswap.getTimeLock()).toNumber();

      const changeUniswapProxy = async (address) => {
        await paraswap.changeUniswapProxy(address, { from: PARASWAP_OWNER });
        for (let i = 0; i < timelock; i += 1) {
          await utils.evmMine();
        }
        await paraswap.confirmUniswapProxyChange({ from: PARASWAP_OWNER });
        await paraswapFilter.updateIsValidUniswapProxy();
      };

      await changeUniswapProxy(other);

      await testTrade({
        method: "swapOnUniswap", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await testTrade({
        method: "swapOnUniswapFork", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });

      await changeUniswapProxy(UNISWAP_PROXY);
    });

    it("should not allow simpleSwap via unauthorised callee", async () => {
      await argent.dappRegistry.removeDapp(0, uniswapV1Exchanges[tokenA.address].address);
      await testTrade({
        method: "simpleSwap", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await argent.dappRegistry.addDapp(0, uniswapV1Exchanges[tokenA.address].address, ZERO_ADDRESS);
    });

    it("should not allow simpleSwap via unauthorised Augustus method", async () => {
      const methodData = paraswap.contract.methods.paused().encodeABI(); // unauthorised method on Augustus contract
      const simpleSwapParams = [
        PARASWAP_ETH_TOKEN, tokenA.address, 1, 1, 0, [paraswap.address], methodData, [0, 4], [0], wallet.address, "abc", false
      ];
      const swapData = paraswap.contract.methods.simpleSwap(...simpleSwapParams).encodeABI();
      const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
      assert.equal(isValid, false, "authorisation should not have been granted for simpleSwap call to invalid Augustus method");
    });

    it("should not allow simpleSwap via unauthorised ZeroExV2 method", async () => {
      const methodData = zeroExV2TargetExchange.contract.methods.unauthorisedMethod().encodeABI(); // unauthorised method on Augustus contract
      const simpleSwapParams = [
        PARASWAP_ETH_TOKEN, tokenA.address, 1, 1, 0, [zeroExV2TargetExchange.address], methodData, [0, 4], [0], wallet.address, "abc", false
      ];
      const swapData = paraswap.contract.methods.simpleSwap(...simpleSwapParams).encodeABI();
      const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
      assert.equal(isValid, false, "authorisation should not have been granted for simpleSwap call to invalid ZeroExV2 method");
    });

    async function testUnauthorisedAdapter(method) {
      await testTrade({
        method,
        fromToken: PARASWAP_ETH_TOKEN,
        toToken: tokenA.address,
        useUnauthorisedAdapter: true,
        errorReason: "TM: call not authorised"
      });
    }

    it("should not allow multiSwap via unauthorised adapter", async () => {
      await testUnauthorisedAdapter("multiSwap");
    });

    it("should not allow megaSwap via unauthorised adapter", async () => {
      await testUnauthorisedAdapter("megaSwap");
    });

    async function testUnauthorisedTargetExchange(method) {
      await testTrade({
        method,
        fromToken: PARASWAP_ETH_TOKEN,
        toToken: tokenA.address,
        useUnauthorisedTargetExchange: true,
        errorReason: "TM: call not authorised"
      });
    }

    it("should not allow multiSwap via unauthorised target exchange", async () => {
      await testUnauthorisedTargetExchange("multiSwap");
    });

    it("should not allow megaSwap via unauthorised target exchange", async () => {
      await testUnauthorisedTargetExchange("megaSwap");
    });
  });

  describe("authorisations", () => {
    describe("multiswap", () => {
      async function testMultiSwapAuthorisation({
        fromToken,
        toToken,
        routes,
        expectValid = true,
        beneficiary = ZERO_ADDRESS,
        fromAmount = web3.utils.toWei("0.01"),
        toAmount = 1,
      }) {
        const swapData = getMultiSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary, routes });
        const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
        assert.equal(isValid, expectValid, `authorisation should  ${expectValid ? "" : "not"} have been granted for multiSwap`);
      }

      it("authorises a multiswap paraswappool trade", async () => {
        const fromToken = PARASWAP_ETH_TOKEN;
        const toToken = tokenA.address;
        const routes = getRoutesForExchange({ fromToken, toToken, exchange: "paraswappoolv4", maker: marketMaker });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: true });
      });

      it("denies a multiswap paraswappool trade with non-whitelisted maker", async () => {
        const fromToken = PARASWAP_ETH_TOKEN;
        const toToken = tokenA.address;
        const routes = getRoutesForExchange({ fromToken, toToken, exchange: "paraswappoolv4", maker: other });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: false });
      });

      it("authorises a multiswap curve trade", async () => {
        const fromToken = PARASWAP_ETH_TOKEN;
        const toToken = tokenA.address;
        const routes = getRoutesForExchange({ fromToken, toToken, exchange: "curve" });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: true });
      });

      it("authorises a multiswap uniswapV3 trade", async () => {
        const fromToken = PARASWAP_ETH_TOKEN;
        const toToken = tokenA.address;
        const routes = getRoutesForExchange({ fromToken, toToken, exchange: "uniswapV3", fee: UNIV3_FEE });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: true });
      });
    });

    describe("simpleswap", () => {
      async function testSimpleSwapAuthorisation({
        exchange, fromToken, toToken, expectValid = true, maker = marketMaker, fromAmount = web3.utils.toWei("0.01"), toAmount = 1
      }) {
        const swapData = getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, exchange, maker });
        const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
        assert.equal(isValid, expectValid, `authorisation should ${expectValid ? "" : "not "}have been granted for simpleswap`);
      }

      function testSimpleSwapAuthorisationViaExchange(exchange) {
        describe(`simpleSwap authorisation via ${exchange}`, () => {
          it("should allow selling ETH for DAI", async () => {
            await testSimpleSwapAuthorisation({ fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, exchange });
          });

          it("should allow selling USDC for ETH", async () => {
            await testSimpleSwapAuthorisation({ fromToken: tokenB.address, toToken: PARASWAP_ETH_TOKEN, exchange });
          });

          it("should allow selling USDC for DAI", async () => {
            await testSimpleSwapAuthorisation({ fromToken: tokenB.address, toToken: tokenA.address, exchange });
          });

          if (["zeroexv2", "zeroexv4"].includes(exchange)) {
            it("should not allow selling USDC for DAI via invalid market maker", async () => {
              await testSimpleSwapAuthorisation({ fromToken: tokenB.address, toToken: tokenA.address, exchange, expectValid: false, maker: other });
            });
          }

          it("should not allow ETH transfers", async () => {
            const { targetExchange } = getSimpleSwapExchangeCallParams({ exchange });
            const simpleSwapParams = getSimpleSwapParams({ targetExchange, swapMethod: null, swapData: null });
            const swapData = paraswap.contract.methods.simpleSwap(...simpleSwapParams).encodeABI();
            const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
            assert.equal(isValid, false, `authorisation should not have been granted for ETH transfer to ${exchange}`);
          });
        });
      }

      ["uniswapv2", "zeroexv2", "zeroexv4", "curve", "uniswapv3"].forEach(testSimpleSwapAuthorisationViaExchange);

      describe("simpleSwap authorisation via weth", () => {
        const exchange = "weth";

        it("should allow selling ETH for token WETH", async () => {
          await testSimpleSwapAuthorisation({ fromToken: PARASWAP_ETH_TOKEN, toToken: weth.address, exchange });
        });

        it("should allow selling WETH for token ETH", async () => {
          await testSimpleSwapAuthorisation({ fromToken: weth.address, toToken: PARASWAP_ETH_TOKEN, exchange });
        });

        it("should allow ETH transfers", async () => {
          const simpleSwapParams = getSimpleSwapParams({ targetExchange: weth, swapMethod: null, swapData: null });
          const swapData = paraswap.contract.methods.simpleSwap(...simpleSwapParams).encodeABI();
          const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
          assert.equal(isValid, true, `authorisation should have been granted for ETH transfer to ${exchange}`);
        });
      });
    });
  });
});
