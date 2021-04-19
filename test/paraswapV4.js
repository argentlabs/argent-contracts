/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect, assert } = chai;
chai.use(bnChai(BN));

// Paraswap
const IAugustusSwapper = artifacts.require("IAugustusSwapper");
const AugustusSwapper = artifacts.require("AugustusSwapperMock");
const Whitelisted = artifacts.require("Whitelisted");
const PartnerRegistry = artifacts.require("PartnerRegistry");
const PartnerDeployer = artifacts.require("PartnerDeployer");
const Uniswap = artifacts.require("Uniswap");
const UniswapV2 = artifacts.require("UniswapV2Mock");
const UniswapProxy = artifacts.require("UniswapProxyTest");
const UniswapV3Router = artifacts.require("UniswapV3Router");
const ZeroxV2TargetExchange = artifacts.require("ZeroxV2TargetExchangeMock");
const ZeroxV4TargetExchange = artifacts.require("ZeroxV4TargetExchangeMock");
const CurvePool = artifacts.require("CurvePoolMock");
const Curve = artifacts.require("Curve");

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");
const WETH = artifacts.require("WETH9");

// Argent
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const ParaswapFilter = artifacts.require("ParaswapFilter");
const ParaswapUniV2RouterFilter = artifacts.require("ParaswapUniV2RouterFilter");
const ZeroExV2Filter = artifacts.require("ZeroExV2Filter");
const ZeroExV4Filter = artifacts.require("ZeroExV4Filter");
const CurveFilter = artifacts.require("CurveFilter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const ERC20 = artifacts.require("TestERC20");
const TokenRegistry = artifacts.require("TokenRegistry");

// Utils
const RelayManager = require("../utils/relay-manager");
const { deployUniswap } = require("../utils/defi-deployer");
const { getRouteParams, getParaswappoolData, getSimpleSwapParams } = require("../utils/paraswap/sell-helper");
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, initNonce, encodeCalls, asciiToBytes32 } = require("../utils/utilities.js");

// Constants
const DECIMALS = 18; // number of decimal for TOKEN_A, TOKEN_B contracts
const PARASWAP_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;
const TOKEN_A_LIQ = web3.utils.toWei("300");
const TOKEN_B_LIQ = web3.utils.toWei("300");
const TOKEN_C_LIQ = web3.utils.toWei("300");
const WETH_LIQ = web3.utils.toWei("1");

contract("Paraswap Filter", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const other = accounts[2];
  const marketMaker = accounts[3];
  const relayer = accounts[4];
  const zeroExV2 = accounts[5];
  const zeroExV4 = accounts[6];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let dappRegistry;

  let uniswapV1Factory;
  let uniswapV1Exchanges;
  let uniswapV2Factory;
  let zeroExV2TargetExchange;
  let zeroExV4TargetExchange;
  let curvePool;
  let uniswapV1Adapter;
  let uniswapV2Adapter;
  let sushiswapAdapter;
  let linkswapAdapter;
  let defiswapAdapter;
  let zeroExV2Adapter;
  let zeroExV4Adapter;
  let curveAdapter;
  let unauthorisedAdapter;
  let initCode;
  let tokenA;
  let tokenB;
  let tokenC;
  let paraswap;
  let paraswapProxy;
  let paraswapFilter;
  let tokenRegistry;
  let uniswapProxy;
  let uniV3Router;

  before(async () => {
    // Deploy test tokens
    tokenA = await ERC20.new([infrastructure], new BN(TOKEN_A_LIQ).muln(3), DECIMALS);
    tokenB = await ERC20.new([infrastructure], new BN(TOKEN_B_LIQ).muln(3), DECIMALS);
    tokenC = await ERC20.new([infrastructure], new BN(TOKEN_C_LIQ).muln(3), DECIMALS);

    // Fake Adapters/TargetExchanges
    zeroExV2Adapter = { address: zeroExV2 };
    zeroExV4Adapter = { address: zeroExV4 };
    zeroExV2TargetExchange = await ZeroxV2TargetExchange.new();
    zeroExV4TargetExchange = await ZeroxV4TargetExchange.new();
    curvePool = await CurvePool.new();

    // Deploy Uniswap
    const ethPerToken = new BN(10).pow(new BN(16));
    const { uniswapFactory, uniswapExchanges } = (await deployUniswap(
      infrastructure, [tokenA, tokenB, tokenC], [ethPerToken, ethPerToken, ethPerToken]
    ));
    uniswapV1Factory = uniswapFactory;
    uniswapV1Exchanges = uniswapExchanges;

    // Deploy UniswapV2
    uniswapV2Factory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const weth = await WETH.new();
    const uniswapRouter = await UniswapV2Router01.new(uniswapV2Factory.address, weth.address);
    initCode = await uniswapV2Factory.getKeccakOfPairCreationCode();
    await weth.deposit({ value: new BN(WETH_LIQ).muln(3) });
    await weth.approve(uniswapRouter.address, new BN(WETH_LIQ).muln(3));
    await tokenA.approve(uniswapRouter.address, new BN(TOKEN_A_LIQ).muln(2));
    await tokenB.approve(uniswapRouter.address, new BN(TOKEN_B_LIQ).muln(2));
    await tokenC.approve(uniswapRouter.address, new BN(TOKEN_C_LIQ));
    const timestamp = await utils.getTimestamp();
    await uniswapRouter.addLiquidity(tokenA.address, weth.address, TOKEN_A_LIQ, WETH_LIQ, 1, 1, infrastructure, timestamp + 300);
    await uniswapRouter.addLiquidity(tokenB.address, weth.address, TOKEN_B_LIQ, WETH_LIQ, 1, 1, infrastructure, timestamp + 300);
    await uniswapRouter.addLiquidity(tokenA.address, tokenB.address, TOKEN_A_LIQ, TOKEN_B_LIQ, 1, 1, infrastructure, timestamp + 300);
    await uniswapRouter.addLiquidity(tokenC.address, weth.address, TOKEN_C_LIQ, WETH_LIQ, 1, 1, infrastructure, timestamp + 300);

    // Deploy Paraswap
    uniswapProxy = await UniswapProxy.new(weth.address, uniswapV2Factory.address, initCode);
    const paraswapWhitelist = await Whitelisted.new();
    const partnerDeployer = await PartnerDeployer.new();
    const partnerRegistry = await PartnerRegistry.new(partnerDeployer.address);
    paraswap = await IAugustusSwapper.at((await AugustusSwapper.new()).address);
    await paraswap.initialize(
      paraswapWhitelist.address,
      ZERO_ADDRESS,
      partnerRegistry.address,
      infrastructure,
      uniswapProxy.address);
    uniswapV1Adapter = await Uniswap.new();
    uniswapV2Adapter = await UniswapV2.new(weth.address, asciiToBytes32("Uniswap"));
    sushiswapAdapter = await UniswapV2.new(weth.address, asciiToBytes32("Sushiswap"));
    linkswapAdapter = await UniswapV2.new(weth.address, asciiToBytes32("Linkswap"));
    defiswapAdapter = await UniswapV2.new(weth.address, asciiToBytes32("Defiswap"));
    curveAdapter = await Curve.new();
    unauthorisedAdapter = await Uniswap.new();
    const wlr = await paraswapWhitelist.WHITELISTED_ROLE();
    await paraswapWhitelist.grantRole(wlr, uniswapV1Adapter.address);
    await paraswap.initializeAdapter(uniswapV1Adapter.address, web3.eth.abi.encodeParameter(
      { ParentStruct: { factory: "address" } },
      { factory: uniswapV1Factory.address }));
    for (const adapter of [uniswapV2Adapter, sushiswapAdapter, linkswapAdapter, defiswapAdapter]) {
      await paraswapWhitelist.grantRole(wlr, adapter.address);
      await paraswap.initializeAdapter(adapter.address, web3.eth.abi.encodeParameter(
        { ParentStruct: { uinswapV2Router: "address", factory: "address", initCode: "bytes32", } },
        { uinswapV2Router: uniswapRouter.address, factory: uniswapV2Factory.address, initCode }));
    }
    paraswapProxy = await paraswap.getTokenTransferProxy();
    uniV3Router = await UniswapV3Router.new(uniswapV2Factory.address, weth.address, initCode);

    // deploy Argent
    registry = await Registry.new();
    tokenRegistry = await TokenRegistry.new();
    const pairs = [
      await uniswapV2Factory.allPairs(0), // tokenA-weth uniV2
      await uniswapV2Factory.allPairs(1), // tokenB-weth uniV2
      await uniswapV2Factory.allPairs(2), // tokenA-tokenB uniV2
      uniswapExchanges[tokenA.address].address, // tokenA-eth uniV1
      uniswapExchanges[tokenB.address].address // tokenB-eth uniV1
    ];
    await tokenRegistry.setTradableForTokenList([tokenA.address, tokenB.address, ...pairs], Array(2 + pairs.length).fill(true));
    dappRegistry = await DappRegistry.new(0);
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      dappRegistry.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);
    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    paraswapFilter = await ParaswapFilter.new(
      tokenRegistry.address,
      dappRegistry.address,
      paraswap.address,
      uniswapProxy.address,
      [uniswapV2Factory.address, uniswapV2Factory.address, uniswapV2Factory.address],
      [initCode, initCode, initCode],
      [
        uniswapV1Adapter.address,
        uniswapV2Adapter.address,
        sushiswapAdapter.address,
        linkswapAdapter.address,
        defiswapAdapter.address,
        zeroExV2Adapter.address,
        zeroExV4Adapter.address,
        curveAdapter.address,
      ],
      [uniswapV1Factory.address, zeroExV2TargetExchange.address, zeroExV4TargetExchange.address, curvePool.address],
      [marketMaker]);
    const proxyFilter = await OnlyApproveFilter.new();
    const paraswapUniV2RouterFilter = await ParaswapUniV2RouterFilter.new(tokenRegistry.address, uniswapV2Factory.address, initCode, weth.address);
    const zeroExV2Filter = await ZeroExV2Filter.new([marketMaker]);
    const zeroExV4Filter = await ZeroExV4Filter.new([marketMaker]);
    const curveFilter = await CurveFilter.new();
    await dappRegistry.addDapp(0, paraswap.address, paraswapFilter.address);
    await dappRegistry.addDapp(0, paraswapProxy, proxyFilter.address);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenA.address].address, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenB.address].address, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenC.address].address, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniV3Router.address, paraswapUniV2RouterFilter.address);
    await dappRegistry.addDapp(0, zeroExV2TargetExchange.address, zeroExV2Filter.address);
    await dappRegistry.addDapp(0, zeroExV4TargetExchange.address, zeroExV4Filter.address);
    await dappRegistry.addDapp(0, curvePool.address, curveFilter.address);
    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, tokenRegistry.address);
  });

  beforeEach(async () => {
    // create wallet
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    // fund wallet
    await wallet.send(web3.utils.toWei("1"));
    await tokenA.mint(wallet.address, web3.utils.toWei("1000"));
    await tokenB.mint(wallet.address, web3.utils.toWei("1000"));
    await tokenC.mint(wallet.address, web3.utils.toWei("1000"));

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  async function getBalance(tokenAddress, _wallet) {
    let balance;
    if (tokenAddress === PARASWAP_ETH_TOKEN) {
      balance = await utils.getBalance(_wallet.address);
    } else if (tokenAddress === tokenA.address) {
      balance = await tokenA.balanceOf(_wallet.address);
    } else if (tokenAddress === tokenB.address) {
      balance = await tokenB.balanceOf(_wallet.address);
    } else {
      balance = await tokenC.balanceOf(_wallet.address);
    }
    return balance;
  }

  const multiCall = async (transactions, { errorReason = null }) => {
    const txReceipt = await manager.relay(
      module, "multiCall", [wallet.address, transactions], wallet, [owner], 1, ETH_TOKEN, relayer
    );
    const { success, error } = utils.parseRelayReceipt(txReceipt);
    if (errorReason) {
      assert.isFalse(success, "multiCall should have failed");
      assert.equal(error, errorReason);
    } else {
      assert.isTrue(success, `multiCall failed: "${error}"`);
    }
  };

  function getParaswappoolRoutes({ fromToken, toToken, maker }) {
    return [{
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
  }

  function getUniswapRoutes({ fromToken, toToken }) {
    return [{
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
  }

  function getCurveRoutes({ fromToken, toToken }) {
    return [{
      exchange: "curve",
      percent: "100",
      data: { tokenFrom: fromToken, tokenTo: toToken },
    }];
  }

  function getPath({ fromToken, toToken, routes, useUnauthorisedAdapter = false, useUnauthorisedTargetExchange = false }) {
    const exchanges = {
      uniswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : uniswapV1Adapter.address,
      uniswapv2: useUnauthorisedAdapter ? unauthorisedAdapter.address : uniswapV2Adapter.address,
      sushiswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : sushiswapAdapter.address,
      linkswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : linkswapAdapter.address,
      defiswap: useUnauthorisedAdapter ? unauthorisedAdapter.address : defiswapAdapter.address,
      paraswappoolv2: useUnauthorisedAdapter ? unauthorisedAdapter.address : zeroExV2Adapter.address,
      paraswappoolv4: useUnauthorisedAdapter ? unauthorisedAdapter.address : zeroExV4Adapter.address,
      curve: useUnauthorisedAdapter ? unauthorisedAdapter.address : curveAdapter.address,
    };
    const targetExchanges = {
      uniswap: useUnauthorisedTargetExchange ? other : uniswapV1Factory.address,
      uniswapv2: ZERO_ADDRESS,
      sushiswap: ZERO_ADDRESS,
      linkswap: ZERO_ADDRESS,
      defiswap: ZERO_ADDRESS,
      paraswappoolv2: useUnauthorisedTargetExchange ? other : zeroExV2TargetExchange.address,
      paraswappoolv4: useUnauthorisedTargetExchange ? other : zeroExV4TargetExchange.address,
      curve: useUnauthorisedTargetExchange ? other : curvePool.address,
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
    routes = getUniswapRoutes({ fromToken, toToken })
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
    routes = getUniswapRoutes({ fromToken, toToken })
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

    if (exchange === "uniswapv2") {
      targetExchange = uniV3Router;
      swapMethod = "swap";
      swapParams = [fromAmount, toAmount, [fromToken, toToken]];
    } else if (exchange === "uniswap") {
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
      targetExchange = zeroExV2TargetExchange;
      swapMethod = "marketSellOrdersNoThrow";
      const { orders, signatures } = getParaswappoolData({ maker, version: 2 });
      swapParams = [orders, 0, signatures];
    } else if (exchange === "zeroexv4") {
      targetExchange = zeroExV4TargetExchange;
      swapMethod = "fillRfqOrder";
      const { order, signature } = getParaswappoolData({ fromToken, toToken, maker, version: 4 });
      swapParams = [order, signature, 0];
    } else if (exchange === "curve") {
      targetExchange = curvePool;
      swapMethod = "exchange";
      swapParams = [0, 1, fromAmount, toAmount];
    }

    return { targetExchange, swapMethod, swapParams };
  }

  function getTokenContract(tokenAddress) {
    let tokenContract;
    if (tokenAddress === tokenA.address) {
      tokenContract = tokenA;
    } else if (tokenAddress === tokenB.address) {
      tokenContract = tokenB;
    } else if (tokenAddress === tokenC.address) {
      tokenContract = tokenC;
    } else {
      tokenContract = { address: PARASWAP_ETH_TOKEN };
    }
    return tokenContract;
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
    return paraswap.contract.methods.swapOnUniswapFork(uniswapV2Factory.address, initCode, fromAmount, toAmount, [fromToken, toToken], 0).encodeABI();
  }

  async function testTrade({
    method,
    fromToken,
    toToken,
    beneficiary = ZERO_ADDRESS,
    fromAmount = web3.utils.toWei("0.01"),
    toAmount = 1,
    useUnauthorisedAdapter = false,
    useUnauthorisedTargetExchange = false,
    errorReason = null,
    exchange = "uniswap"
  }) {
    const beforeFrom = await getBalance(fromToken, wallet);
    const beforeTo = await getBalance(toToken, wallet);
    expect(beforeFrom).to.be.gte.BN(fromAmount); // wallet should have enough of fromToken
    const transactions = [];

    // token approval if necessary
    if (fromToken !== PARASWAP_ETH_TOKEN) {
      let token;
      if (fromToken === tokenA.address) token = tokenA;
      else if (fromToken === tokenB.address) token = tokenB;
      else token = tokenC;

      const approveData = token.contract.methods.approve(paraswapProxy, fromAmount).encodeABI();
      transactions.push(encodeTransaction(fromToken, 0, approveData));
    }

    // token swap
    let swapData;
    if (method === "multiSwap") {
      swapData = getMultiSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary, useUnauthorisedAdapter, useUnauthorisedTargetExchange });
    } else if (method === "simpleSwap") {
      swapData = getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary, exchange });
    } else if (method === "swapOnUniswap") {
      swapData = getSwapOnUniswapData({ fromToken, toToken, fromAmount, toAmount });
    } else if (method === "swapOnUniswapFork") {
      swapData = getSwapOnUniswapForkData({ fromToken, toToken, fromAmount, toAmount });
    } else if (method === "megaSwap") {
      swapData = getMegaSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary, useUnauthorisedAdapter, useUnauthorisedTargetExchange });
    } else {
      throw new Error("Invalid method");
    }
    const value = fromToken === PARASWAP_ETH_TOKEN ? fromAmount : 0;
    transactions.push(encodeTransaction(paraswap.address, value, swapData));

    await multiCall(transactions, { errorReason });
    if (!errorReason) {
      const afterFrom = await getBalance(fromToken, wallet);
      const afterTo = await getBalance(toToken, wallet);
      expect(beforeFrom).to.be.gt.BN(afterFrom);
      expect(afterTo).to.be.gt.BN(beforeTo);
    }
  }

  function testsForMethod(method) {
    describe(`${method} trades`, () => {
      it("should sell ETH for token A", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address });
      });
      it("should sell token B for ETH", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: PARASWAP_ETH_TOKEN });
      });
      it("should sell token B for token A", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: tokenA.address });
      });
      it("should not sell ETH for non-tradable token C", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenC.address, errorReason: "TM: call not authorised" });
      });
    });
  }

  ["multiSwap", "swapOnUniswap", "swapOnUniswapFork", "megaSwap"].forEach(testsForMethod);

  function testSimpleSwapTradesViaExchange(exchange) {
    const method = "simpleSwap";
    describe(`simpleSwap trades via ${exchange}`, () => {
      it("should sell ETH for token A", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, exchange });
      });
      it("should sell token B for ETH", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: PARASWAP_ETH_TOKEN, exchange });
      });
      it("should sell token B for token A", async () => {
        await testTrade({ method, fromToken: tokenB.address, toToken: tokenA.address, exchange });
      });
      it("should not sell ETH for non-tradable token C", async () => {
        await testTrade({ method, fromToken: PARASWAP_ETH_TOKEN, toToken: tokenC.address, errorReason: "TM: call not authorised", exchange
        });
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
      await paraswap.changeUniswapProxy(other);
      await paraswapFilter.updateIsValidUniswapProxy();
      await testTrade({
        method: "swapOnUniswap", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await testTrade({
        method: "swapOnUniswapFork", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await paraswap.changeUniswapProxy(uniswapProxy.address);
      await paraswapFilter.updateIsValidUniswapProxy();
    });

    it("should not allow simpleSwap via unauthorised callee", async () => {
      await dappRegistry.removeDapp(0, uniswapV1Exchanges[tokenA.address].address);
      await testTrade({
        method: "simpleSwap", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenA.address].address, ZERO_ADDRESS);
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
        const routes = getParaswappoolRoutes({ fromToken, toToken, maker: marketMaker });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: true });
      });

      it("denies a multiswap paraswappool trade with non-whitelisted maker", async () => {
        const fromToken = PARASWAP_ETH_TOKEN;
        const toToken = tokenA.address;
        const routes = getParaswappoolRoutes({ fromToken, toToken, maker: other });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: false });
      });

      it("authorises a multiswap curve trade", async () => {
        const fromToken = PARASWAP_ETH_TOKEN;
        const toToken = tokenA.address;
        const routes = getCurveRoutes({ fromToken, toToken });
        await testMultiSwapAuthorisation({ fromToken, toToken, routes, expectValid: true });
      });
    });

    describe("simpleswap", () => {
      function testSimpleSwapAuthorisationViaExchange(exchange) {
        describe(`simpleSwap authorisation via ${exchange}`, () => {
          async function testSimpleSwapAuthorisation({
            fromToken, toToken, expectValid = true, maker = marketMaker, fromAmount = web3.utils.toWei("0.01"), toAmount = 1
          }) {
            const swapData = getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, exchange, maker });
            const isValid = await paraswapFilter.isValid(wallet.address, paraswap.address, paraswap.address, swapData);
            assert.equal(isValid, expectValid, `authorisation should ${expectValid ? "" : "not"} have been granted for simpleswap`);
          }
          it("should allow selling ETH for token A", async () => {
            await testSimpleSwapAuthorisation({ fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address });
          });
          it("should allow selling token B for ETH", async () => {
            await testSimpleSwapAuthorisation({ fromToken: tokenB.address, toToken: PARASWAP_ETH_TOKEN });
          });
          it("should allow selling token B for token A", async () => {
            await testSimpleSwapAuthorisation({ fromToken: tokenB.address, toToken: tokenA.address });
          });
          if (["zeroexv2", "zeroexv4"].includes(exchange)) {
            it("should not allow selling token B for token A via invalid market maker", async () => {
              await testSimpleSwapAuthorisation({ fromToken: tokenB.address, toToken: tokenA.address, expectValid: false, maker: other });
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

      ["uniswapv2", "zeroexv2", "zeroexv4", "curve"].forEach(testSimpleSwapAuthorisationViaExchange);
    });
  });
});
