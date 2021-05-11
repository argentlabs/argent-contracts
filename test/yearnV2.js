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
const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const YearnV2Filter = artifacts.require("YearnV2Filter");
const WethFilter = artifacts.require("WethFilter");

// YearnV2
const Vault = artifacts.require("yVaultV2Mock");

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

contract("yEarnV2 Filter", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const other = accounts[3];
  const relayer = accounts[4];
  const refundAddress = accounts[7];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let factory;
  let dappRegistry;

  let uniswapRouter;

  let weth;
  let pool;

  before(async () => {
    // Deploy test token
    weth = await WETH.new();

    // Deploy yVault
    pool = await Vault.new();

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);

    // deploy Argent
    registry = await Registry.new();
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
    const yearnV2filter = await YearnV2Filter.new();
    const wethFilter = await WethFilter.new();
    await dappRegistry.addDapp(0, pool.address, yearnV2filter.address);
    await dappRegistry.addDapp(0, weth.address, wethFilter.address);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);

    const walletImplementation = await BaseWallet.new();
    factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);
    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    // create wallet
    const walletAddress = await utils.createWallet(factory.address, owner, [module.address], guardian1);
    wallet = await BaseWallet.at(walletAddress);

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

  const deposit0 = async () => multiCall(encodeCalls([
    [weth, "approve", [pool.address, AMOUNT]],
    [pool, "deposit", []]
  ]));

  const deposit1 = async () => multiCall(encodeCalls([
    [weth, "approve", [pool.address, AMOUNT]],
    [pool, "deposit", [AMOUNT]]
  ]));

  const depositETH0 = async () => multiCall(encodeCalls([
    [weth, "deposit", [], AMOUNT],
    [weth, "approve", [pool.address, AMOUNT]],
    [pool, "deposit", []]
  ]));

  const depositETH1 = async () => multiCall(encodeCalls([
    [weth, "deposit", [], AMOUNT],
    [weth, "approve", [pool.address, AMOUNT]],
    [pool, "deposit", [AMOUNT]]
  ]));

  const withdraw0 = async () => multiCall(encodeCalls([
    [pool, "withdraw", []]
  ]));

  const withdraw1 = async () => multiCall(encodeCalls([
    [pool, "withdraw", [AMOUNT]]
  ]));

  const withdraw3 = async (recipient = wallet.address) => multiCall(encodeCalls([
    [pool, "withdraw", [AMOUNT, recipient, 2]]
  ]));

  const withdrawETH1 = async () => multiCall(encodeCalls([
    [pool, "withdraw", [AMOUNT]],
    [weth, "withdraw", [AMOUNT]],
  ]));

  describe("deposits", () => {
    it("should allow deposits (0 param)", async () => {
      const { success, error } = await deposit0();
      assert.isTrue(success, `deposit0 failed: "${error}"`);
    });
    it("should allow deposits (1 param)", async () => {
      const { success, error } = await deposit1();
      assert.isTrue(success, `deposit1 failed: "${error}"`);
    });

    it("should allow ETH deposits (0 param)", async () => {
      const { success, error } = await depositETH0();
      assert.isTrue(success, `depositETH0 failed: "${error}"`);
    });

    it("should allow ETH deposits (1 param)", async () => {
      const { success, error } = await depositETH1();
      assert.isTrue(success, `depositETH1 failed: "${error}"`);
    });
  });

  describe("withdrawals", () => {
    it("should allow withdrawals (0 param)", async () => {
      await deposit0();
      const { success, error } = await withdraw0();
      assert.isTrue(success, `withdraw0 failed: "${error}"`);
    });

    it("should allow withdrawals (1 param)", async () => {
      await deposit1();
      const { success, error } = await withdraw1();
      assert.isTrue(success, `withdraw1 failed: "${error}"`);
    });

    it("should allow withdrawals (3 param)", async () => {
      await deposit1();
      const { success, error } = await withdraw3();
      assert.isTrue(success, `withdraw3 failed: "${error}"`);
    });

    it("should allow ETH withdrawals (1 param)", async () => {
      await depositETH1();
      const { success, error } = await withdrawETH1();
      assert.isTrue(success, `withdraw3 failed: "${error}"`);
    });

    it("should NOT allow withdrawals to non-wallet ", async () => {
      await deposit0();
      const { success, error } = await withdraw3(other);
      assert.isFalse(success, "withdraw3 should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await multiCall(encodeCalls([[weth, "transfer", [pool.address, AMOUNT]]]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow calling unsupported method", async () => {
    const { success, error } = await multiCall(encodeCalls([[pool, "setManagementFee", [1]]]));
    assert.isFalse(success, "setManagementFee() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH ", async () => {
    const { success, error } = await multiCall([encodeTransaction(pool.address, AMOUNT, "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
