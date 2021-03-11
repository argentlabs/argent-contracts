/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

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
const Filter = artifacts.require("YearnFilter");
const Vault = artifacts.require("yVault");
const Controller = artifacts.require("Controller");
const Strategy = artifacts.require("StrategyMock");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");

// Utils
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, initNonce, encodeCalls, encodeTransaction } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;
const AMOUNT = web3.utils.toWei("0.01");

const RelayManager = require("../utils/relay-manager");

contract("yEarn Filter", (accounts) => {
  let manager;

  const owner = accounts[1];
  const relayer = accounts[4];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let dappRegistry;

  let uniswapRouter;

  let weth;

  let pool;
  let wethPool;
  let tokenPriceRegistry;

  before(async () => {
    // Deploy test token
    weth = await WETH.new();

    // Deploy yVault
    const ctrl = await Controller.new(ZERO_ADDRESS);
    const strat = await Strategy.new();
    await ctrl.approveStrategy(weth.address, strat.address);
    await ctrl.setStrategy(weth.address, strat.address);
    wethPool = await Vault.new(weth.address, ctrl.address);
    pool = await Vault.new(weth.address, ctrl.address);

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);

    // deploy Argent
    registry = await Registry.new();
    tokenPriceRegistry = await TokenPriceRegistry.new();
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
    const wethFilter = await Filter.new(true);
    const filter = await Filter.new(false);
    await dappRegistry.addDapp(0, pool.address, filter.address);
    await dappRegistry.addDapp(0, wethPool.address, wethFilter.address);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    walletImplementation = await BaseWallet.new();
    manager = new RelayManager(guardianStorage.address, tokenPriceRegistry.address);
  });

  beforeEach(async () => {
    // create wallet
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    // fund wallet
    await wallet.send(web3.utils.toWei("1"));
    await weth.deposit({ value: web3.utils.toWei("1") });
    await weth.transfer(wallet.address, web3.utils.toWei("1"));

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  const multiCall = async (transactions) => {
    const txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, transactions],
      wallet,
      [owner],
      1,
      ETH_TOKEN,
      relayer);
    return utils.parseRelayReceipt(txReceipt);
  };

  const deposit = async () => multiCall(encodeCalls([
    [weth, "approve", [pool.address, AMOUNT]],
    [pool, "deposit", [AMOUNT]]
  ]));

  const depositETH = async () => multiCall(encodeCalls([[wethPool, "depositETH", [], AMOUNT]]));

  const withdraw = async ({ all }) => {
    const bal = (await pool.balanceOf(wallet.address)).toString();
    return multiCall(encodeCalls([all ? [pool, "withdrawAll"] : [pool, "withdraw", [bal]]]));
  };

  const withdrawETH = async ({ all }) => {
    const bal = (await wethPool.balanceOf(wallet.address)).toString();
    return multiCall(encodeCalls([all ? [wethPool, "withdrawAllETH"] : [wethPool, "withdrawETH", [bal]]]));
  };

  it("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow ETH deposits", async () => {
    const { success, error } = await depositETH();
    assert.isTrue(success, `depositETH failed: "${error}"`);
  });

  it("should allow withdrawals (withdraw(amount))", async () => {
    await deposit();
    const { success, error } = await withdraw({ all: false });
    assert.isTrue(success, `withdraw(amount) failed: "${error}"`);
  });

  it("should allow withdrawals (withdrawETH(amount))", async () => {
    await depositETH();
    const { success, error } = await withdrawETH({ all: false });
    assert.isTrue(success, `withdrawETH(amount) failed: "${error}"`);
  });

  it("should allow withdrawals (withdrawAll())", async () => {
    await deposit();
    const { success, error } = await withdraw({ all: true });
    assert.isTrue(success, `withdrawAll() failed: "${error}"`);
  });

  it("should allow withdrawals (withdrawAllETH())", async () => {
    await deposit();
    const { success, error } = await withdrawETH({ all: true });
    assert.isTrue(success, `withdrawAllETH() failed: "${error}"`);
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await multiCall(encodeCalls([[weth, "transfer", [pool.address, AMOUNT]]]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method", async () => {
    const { success, error } = await multiCall(encodeCalls([[pool, "earn"]]));
    assert.isFalse(success, "earn() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to non-weth pool", async () => {
    const { success, error } = await multiCall([encodeTransaction(pool.address, AMOUNT, "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should allow sending ETH to weth pool", async () => {
    const { success, error } = await multiCall([encodeTransaction(wethPool.address, AMOUNT, "0x")]);
    assert.isTrue(success, `sending ETH failed: "${error}"`);
  });
});
