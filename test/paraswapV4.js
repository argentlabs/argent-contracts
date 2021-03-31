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
const UniswapProxy = artifacts.require("UniswapProxyTest");

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
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const ERC20 = artifacts.require("TestERC20");
const TokenRegistry = artifacts.require("TokenRegistry");

// Utils
const RelayManager = require("../utils/relay-manager");
const { deployUniswap } = require("../utils/defi-deployer");
const { makePathes } = require("../utils/paraswap/sell-helper");
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, initNonce, encodeCalls } = require("../utils/utilities.js");

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
const WETH_LIQ = web3.utils.toWei("1");

contract("Paraswap Filter", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const other = accounts[2];
  const relayer = accounts[4];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let dappRegistry;

  let uniswapV1Factory;
  let uniswapV1Exchanges;
  let uniswapV1Adapter;
  let uniswapV2Factory;
  let initCode;
  let tokenA;
  let tokenB;
  let paraswap;
  let paraswapProxy;
  let tokenRegistry;
  let uniswapProxy;
  let paraswapFilter;

  before(async () => {
    // Deploy test tokens
    tokenA = await ERC20.new([infrastructure], new BN(TOKEN_A_LIQ).muln(3), DECIMALS);
    tokenB = await ERC20.new([infrastructure], new BN(TOKEN_B_LIQ).muln(3), DECIMALS);

    // Deploy Uniswap
    const { uniswapFactory, uniswapExchanges } = (await deployUniswap(
      infrastructure, [tokenA, tokenB], [new BN(10).pow(new BN(16)), new BN(10).pow(new BN(16))]
    ));
    uniswapV1Factory = uniswapFactory;
    uniswapV1Exchanges = uniswapExchanges;

    // Deploy UniswapV2
    uniswapV2Factory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const weth = await WETH.new();
    const uniswapRouter = await UniswapV2Router01.new(uniswapV2Factory.address, weth.address);
    initCode = await uniswapV2Factory.getKeccakOfPairCreationCode();
    await weth.deposit({ value: new BN(WETH_LIQ).muln(2) });
    await weth.approve(uniswapRouter.address, new BN(WETH_LIQ).muln(2));
    await tokenA.approve(uniswapRouter.address, new BN(TOKEN_A_LIQ).muln(2));
    await tokenB.approve(uniswapRouter.address, new BN(TOKEN_B_LIQ).muln(2));
    const timestamp = await utils.getTimestamp();
    await uniswapRouter.addLiquidity(tokenA.address, weth.address, TOKEN_A_LIQ, WETH_LIQ, 1, 1, infrastructure, timestamp + 300);
    await uniswapRouter.addLiquidity(tokenB.address, weth.address, TOKEN_B_LIQ, WETH_LIQ, 1, 1, infrastructure, timestamp + 300);
    await uniswapRouter.addLiquidity(tokenA.address, tokenB.address, TOKEN_A_LIQ, TOKEN_B_LIQ, 1, 1, infrastructure, timestamp + 300);

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
    const wlr = await paraswapWhitelist.WHITELISTED_ROLE();
    await paraswapWhitelist.grantRole(wlr, uniswapV1Adapter.address);
    await paraswap.initializeAdapter(uniswapV1Adapter.address, web3.eth.abi.encodeParameter(
      { ParentStruct: { factory: "address" } }, { factory: uniswapV1Factory.address }));
    paraswapProxy = await paraswap.getTokenTransferProxy();

    // deploy Argent
    registry = await Registry.new();
    tokenRegistry = await TokenRegistry.new();
    await tokenRegistry.setTradableForTokenList([tokenA.address], [true]);
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
      uniswapProxy.address,
      [uniswapV2Factory.address, uniswapV2Factory.address, uniswapV2Factory.address],
      [initCode, initCode, initCode],
      [uniswapV1Adapter.address]);
    const proxyFilter = await OnlyApproveFilter.new();
    await dappRegistry.addDapp(0, paraswap.address, paraswapFilter.address);
    await dappRegistry.addDapp(0, paraswapProxy, proxyFilter.address);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenA.address].address, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenB.address].address, ZERO_ADDRESS);
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

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  async function getBalance(tokenAddress, _wallet) {
    let balance;
    if (tokenAddress === PARASWAP_ETH_TOKEN) {
      balance = await utils.getBalance(_wallet.address);
    } else if (tokenAddress === tokenA.address) {
      balance = await tokenA.balanceOf(_wallet.address);
    } else {
      balance = await tokenB.balanceOf(_wallet.address);
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

  function getPath({ fromToken, toToken, fromAmount, toAmount }) {
    const routes = [{
      exchange: "uniswap",
      percent: "100",
      srcAmount: fromAmount.toString(),
      destAmount: toAmount.toString(),
      data: { tokenFrom: fromToken, tokenTo: toToken },
    }];
    const exchanges = { uniswap: uniswapV1Adapter.address };
    const targetExchanges = { uniswap: uniswapV1Factory.address };
    return makePathes(fromToken, toToken, routes, exchanges, targetExchanges, false);
  }

  function getMultiSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary }) {
    const path = getPath({ fromToken, toToken, fromAmount, toAmount });
    return paraswap.contract.methods.multiSwap({
      fromToken, fromAmount, toAmount, expectedAmount: 0, beneficiary, referrer: "abc", useReduxToken: false, path
    }).encodeABI();
  }

  function getMegaSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary }) {
    const path = getPath({ fromToken, toToken, fromAmount, toAmount });
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

  function getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary }) {
    let exchangeData;
    const callees = [];
    const startIndexes = [];
    const values = [];
    if (fromToken === PARASWAP_ETH_TOKEN) {
      exchangeData = uniswapV1Exchanges[toToken].contract.methods.ethToTokenSwapInput(1, 99999999999).encodeABI();
      startIndexes.push(0, exchangeData.length / 2 - 1);
      callees.push(uniswapV1Exchanges[toToken].address);
      values.push(fromAmount);
    } else {
      const token = ((fromToken === tokenA.address) ? tokenA : tokenB);
      callees.push(fromToken, uniswapV1Exchanges[fromToken].address);
      values.push(0, 0);
      exchangeData = token.contract.methods.approve(uniswapV1Exchanges[fromToken].address, fromAmount).encodeABI();
      startIndexes.push(0, exchangeData.length / 2 - 1);
      if (toToken === PARASWAP_ETH_TOKEN) {
        exchangeData += uniswapV1Exchanges[fromToken].contract.methods.tokenToEthSwapInput(
          fromAmount, 1, 99999999999).encodeABI().slice(2);
      } else {
        exchangeData += uniswapV1Exchanges[fromToken].contract.methods.tokenToTokenSwapInput(
          fromAmount, 1, 1, 99999999999, toToken).encodeABI().slice(2);
      }
      startIndexes.push(exchangeData.length / 2 - 1);
    }
    const benef = beneficiary === ZERO_ADDRESS ? wallet.address : beneficiary;
    return paraswap.contract.methods.simpleSwap(
      fromToken, toToken, fromAmount, toAmount, 0, callees, exchangeData, startIndexes, values, benef, "abc", false,
    ).encodeABI();
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
    errorReason = null
  }) {
    const beforeFrom = await getBalance(fromToken, wallet);
    const beforeTo = await getBalance(toToken, wallet);
    expect(beforeFrom).to.be.gte.BN(fromAmount); // wallet should have enough of fromToken
    const transactions = [];

    // token approval if necessary
    if (fromToken !== PARASWAP_ETH_TOKEN) {
      const token = ((fromToken === tokenA.address) ? tokenA : tokenB);
      const approveData = token.contract.methods.approve(paraswapProxy, fromAmount).encodeABI();
      transactions.push(encodeTransaction(fromToken, 0, approveData));
    }

    // token swap
    let swapData;
    if (method === "multiSwap") {
      swapData = getMultiSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary });
    } else if (method === "simpleSwap") {
      swapData = getSimpleSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary });
    } else if (method === "swapOnUniswap") {
      swapData = getSwapOnUniswapData({ fromToken, toToken, fromAmount, toAmount });
    } else if (method === "swapOnUniswapFork") {
      swapData = getSwapOnUniswapForkData({ fromToken, toToken, fromAmount, toAmount });
    } else if (method === "megaSwap") {
      swapData = getMegaSwapData({ fromToken, toToken, fromAmount, toAmount, beneficiary });
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
      it("should not sell token A for non-tradable token B", async () => {
        await testTrade({ method, fromToken: tokenA.address, toToken: tokenB.address, errorReason: "TM: call not authorised" });
      });
    });
  }

  ["multiSwap", "simpleSwap", "swapOnUniswap", "swapOnUniswapFork", "megaSwap"].forEach(testsForMethod);

  describe("unauthorised access", () => {
    it("should not allow sending ETH without calling an authorised method", async () => {
      await multiCall([encodeTransaction(paraswap.address, web3.utils.toWei("0.01"), "0x")],
        { errorReason: "TM: call not authorised" });
    });

    it("should not allow unsupported method call", async () => {
      await multiCall(encodeCalls([[paraswap, "getFeeWallet"]]),
        { errorReason: "TM: call not authorised" });
    });

    it("should not allow swapOnUniswapFork via unauthorised uniswap proxy", async () => {
      await paraswap.changeUniswapProxy(other);
      await testTrade({
        method: "swapOnUniswapFork", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await paraswap.changeUniswapProxy(uniswapProxy.address);
    });

    it("should not allow simpleSwap via unauthorised callee", async () => {
      await dappRegistry.removeDapp(0, uniswapV1Exchanges[tokenA.address].address);
      await testTrade({
        method: "simpleSwap", fromToken: PARASWAP_ETH_TOKEN, toToken: tokenA.address, errorReason: "TM: call not authorised"
      });
      await dappRegistry.addDapp(0, uniswapV1Exchanges[tokenA.address].address, ZERO_ADDRESS);
    });

    async function testUnauthorisedAdapter(method) {
      await paraswapFilter.setAuthorised([uniswapV1Adapter.address], [false]);
      await testTrade({
        method,
        fromToken: PARASWAP_ETH_TOKEN,
        toToken: tokenA.address,
        errorReason: "TM: call not authorised"
      });
      await paraswapFilter.setAuthorised([uniswapV1Adapter.address], [true]);
    }

    it("should not allow multiSwap via unauthorised adapter", async () => {
      await testUnauthorisedAdapter("multiSwap");
    });

    it("should not allow megaSwap via unauthorised adapter", async () => {
      await testUnauthorisedAdapter("megaSwap");
    });
  });
});
