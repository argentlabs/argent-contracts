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
const BalancerFilter = artifacts.require("BalancerFilter");
const WethFilter = artifacts.require("WethFilter");
const BPool = artifacts.require("BPool");
const ERC20 = artifacts.require("TestERC20");

// Utils
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, initNonce, encodeCalls, encodeTransaction } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;
const DECIMALS = 18; // number of decimal for TOKEN_A, TOKEN_B contracts

const RelayManager = require("../utils/relay-manager");

contract("Balancer Filter", (accounts) => {
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
  let balFilter;
  let dappRegistry;

  let uniswapRouter;

  let tokenA;
  let tokenB;
  let weth;
  let pool;
  let wethPool;

  before(async () => {
    // Deploy Balancer Pools
    pool = await BPool.new();
    wethPool = await BPool.new();

    // Deploy test tokens
    weth = await WETH.new();
    await weth.deposit({ value: web3.utils.toWei("1"), from: infrastructure });
    tokenA = await ERC20.new([infrastructure], web3.utils.toWei("2000"), DECIMALS);
    tokenB = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);

    // Setup Balancer Pools
    await tokenA.approve(pool.address, web3.utils.toWei("1000"));
    await tokenB.approve(pool.address, web3.utils.toWei("1000"));
    await pool.bind(tokenA.address, web3.utils.toWei("1000"), web3.utils.toWei("1"));
    await pool.bind(tokenB.address, web3.utils.toWei("1000"), web3.utils.toWei("1"));
    await pool.finalize();

    await tokenA.approve(wethPool.address, web3.utils.toWei("1000"));
    await weth.approve(wethPool.address, web3.utils.toWei("0.1"));
    await wethPool.bind(tokenA.address, web3.utils.toWei("1000"), web3.utils.toWei("1"));
    await wethPool.bind(weth.address, web3.utils.toWei("0.1"), web3.utils.toWei("1"));
    await wethPool.finalize();

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
    balFilter = await BalancerFilter.new();
    const wethFilter = await WethFilter.new();
    await dappRegistry.addDapp(0, pool.address, balFilter.address);
    await dappRegistry.addDapp(0, wethPool.address, balFilter.address);
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
    await wallet.send(web3.utils.toWei("0.1"));
    await weth.deposit({ value: web3.utils.toWei("0.1") });
    await weth.transfer(wallet.address, web3.utils.toWei("0.1"));
    await tokenA.mint(wallet.address, web3.utils.toWei("1000"));

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  const amount = web3.utils.toWei("1");
  const ethAmount = web3.utils.toWei("0.01");

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
    [tokenA, "approve", [pool.address, amount]],
    [pool, "joinswapExternAmountIn", [tokenA.address, amount, 1]]
  ]));

  const depositETH = async () => multiCall(encodeCalls([
    [weth, "deposit", [], ethAmount],
    [weth, "approve", [wethPool.address, ethAmount]],
    [wethPool, "joinswapExternAmountIn", [weth.address, ethAmount, 1]]
  ]));

  const withdraw = async ({ fixedOutAmount }) => {
    const bpt = await pool.balanceOf(wallet.address);
    return multiCall(encodeCalls([
      [pool, "approve", [pool.address, bpt.toString()]],
      (fixedOutAmount ? [
        pool, "exitswapExternAmountOut", [tokenA.address, web3.utils.toWei("0.1"), bpt.toString()]
      ] : [
        pool, "exitswapPoolAmountIn", [tokenA.address, bpt.toString(), 1]
      ])
    ]));
  };

  it("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `joinswapExternAmountIn failed: "${error}"`);
  });

  it("should allow deposits from ETH", async () => {
    const { success, error } = await depositETH();
    assert.isTrue(success, `joinswapExternAmountIn failed: "${error}"`);
  });

  it("should allow withdrawals (exitswapExternAmountOut)", async () => {
    await deposit();
    const { success, error } = await withdraw({ fixedOutAmount: true });
    assert.isTrue(success, `exitswapExternAmountOut failed: "${error}"`);
  });

  it("should allow withdrawals (exitswapPoolAmountIn)", async () => {
    await deposit();
    const { success, error } = await withdraw({ fixedOutAmount: false });
    assert.isTrue(success, `exitswapPoolAmountIn failed: "${error}"`);
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await multiCall(encodeCalls([
      [tokenA, "transfer", [pool.address, amount]],
    ]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method", async () => {
    const { success, error } = await multiCall(encodeCalls([
      [pool, "swapExactAmountIn", [tokenA.address, web3.utils.toWei("0.1"), tokenB.address, 1, web3.utils.toWei("10000")]]
    ]));
    assert.isFalse(success, "swap should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to pool", async () => {
    const { success, error } = await multiCall([encodeTransaction(pool.address, web3.utils.toWei("0.01"), "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
