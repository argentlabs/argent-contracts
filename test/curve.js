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
const CurveFilter = artifacts.require("CurveFilter");
const WethFilter = artifacts.require("WethFilter");
const ERC20 = artifacts.require("TestERC20");

// Curve
const CurvePool = artifacts.require("CurvePoolMock");

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

contract("Curve Filter", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
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

  let tokenA;
  let tokenB;
  let tokenC;
  let weth;
  let pool;

  before(async () => {
    // Deploy test tokens

    weth = await WETH.new();
    tokenA = await ERC20.new([infrastructure], "1000000000", 18);
    tokenB = await ERC20.new([infrastructure], "1000000000", 18);
    tokenC = await ERC20.new([infrastructure], "1000000000", 18);

    // Deploy Curve pool
    pool = await CurvePool.new();

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
    const curveFilter = await CurveFilter.new();
    const wethFilter = await WethFilter.new();
    await dappRegistry.addDapp(0, pool.address, curveFilter.address);
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

  const deposit2 = async () => multiCall(encodeCalls([
    [weth, "approve", [pool.address, AMOUNT]],
    [tokenA, "approve", [pool.address, AMOUNT]],
    [pool, "add_liquidity(uint256[2],uint256)", [[AMOUNT, AMOUNT], 1]]
  ]));
  const deposit3 = async () => multiCall(encodeCalls([
    [weth, "approve", [pool.address, AMOUNT]],
    [tokenA, "approve", [pool.address, AMOUNT]],
    [tokenB, "approve", [pool.address, AMOUNT]],
    [pool, "add_liquidity(uint256[3],uint256)", [[AMOUNT, AMOUNT, AMOUNT], 1]]
  ]));
  const deposit4 = async () => multiCall(encodeCalls([
    [weth, "approve", [pool.address, AMOUNT]],
    [tokenA, "approve", [pool.address, AMOUNT]],
    [tokenB, "approve", [pool.address, AMOUNT]],
    [tokenC, "approve", [pool.address, AMOUNT]],
    [pool, "add_liquidity(uint256[4],uint256)", [[AMOUNT, AMOUNT, AMOUNT, AMOUNT], 1]]
  ]));

  const withdraw2 = async () => multiCall(encodeCalls([
    [pool, "remove_liquidity(uint256,uint256[2])", [1, [AMOUNT, AMOUNT]]]
  ]));
  const withdraw3 = async () => multiCall(encodeCalls([
    [pool, "remove_liquidity(uint256,uint256[3])", [1, [AMOUNT, AMOUNT, AMOUNT]]]
  ]));
  const withdraw4 = async () => multiCall(encodeCalls([
    [pool, "remove_liquidity(uint256,uint256[4])", [1, [AMOUNT, AMOUNT, AMOUNT, AMOUNT]]]
  ]));

  const swap = async () => multiCall(encodeCalls([
    [pool, "exchange", [0, 1, AMOUNT, 1]]
  ]));
  const swapUnderlying = async () => multiCall(encodeCalls([
    [pool, "exchange_underlying", [0, 1, AMOUNT, 1]]
  ]));

  describe("deposits", () => {
    it("should allow deposit (2 tokens)", async () => {
      const { success, error } = await deposit2();
      assert.isTrue(success, `deposit2 failed: "${error}"`);
    });
    it("should allow deposit (3 tokens)", async () => {
      const { success, error } = await deposit3();
      assert.isTrue(success, `deposit3 failed: "${error}"`);
    });
    it("should allow deposit (4 tokens)", async () => {
      const { success, error } = await deposit4();
      assert.isTrue(success, `deposit4 failed: "${error}"`);
    });
  });

  describe("withdrawals", () => {
    it("should allow withdraw (2 tokens)", async () => {
      const { success, error } = await withdraw2();
      assert.isTrue(success, `withdraw2 failed: "${error}"`);
    });
    it("should allow withdraw (3 tokens)", async () => {
      const { success, error } = await withdraw3();
      assert.isTrue(success, `withdraw3 failed: "${error}"`);
    });
    it("should allow withdraw (4 tokens)", async () => {
      const { success, error } = await withdraw4();
      assert.isTrue(success, `withdraw4 failed: "${error}"`);
    });
  });

  describe("swap", () => {
    it("should allow swap ", async () => {
      const { success, error } = await swap();
      assert.isTrue(success, `swap failed: "${error}"`);
    });
    it("should allow swap of underlying", async () => {
      const { success, error } = await swapUnderlying();
      assert.isTrue(success, `swapUnderlying failed: "${error}"`);
    });
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await multiCall(encodeCalls([[weth, "transfer", [pool.address, AMOUNT]]]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow calling unsupported method", async () => {
    const { success, error } = await multiCall(encodeCalls([[pool, "get_virtual_price", []]]));
    assert.isFalse(success, "setManagementFee() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH ", async () => {
    const { success, error } = await multiCall([encodeTransaction(pool.address, AMOUNT, "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
