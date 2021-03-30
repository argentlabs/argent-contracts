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
const Filter = artifacts.require("BalancerFilter");
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
  const relayer = accounts[4];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let filter;
  let dappRegistry;

  let uniswapRouter;

  let tokenA;
  let tokenB;
  let pool;

  before(async () => {
    // Deploy Balancer Pool
    pool = await BPool.new();

    // Deploy test tokens
    tokenA = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);
    tokenB = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);

    // Setup Balancer Pool
    await tokenA.approve(pool.address, web3.utils.toWei("1000"));
    await tokenB.approve(pool.address, web3.utils.toWei("1000"));
    await pool.bind(tokenA.address, web3.utils.toWei("1000"), web3.utils.toWei("1"));
    await pool.bind(tokenB.address, web3.utils.toWei("1000"), web3.utils.toWei("1"));
    await pool.finalize();

    // Deploy and fund UniswapV2
    const weth = await WETH.new();
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
    filter = await Filter.new();
    await dappRegistry.addDapp(0, pool.address, filter.address);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    walletImplementation = await BaseWallet.new();
    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    // create wallet
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    // fund wallet
    await wallet.send(web3.utils.toWei("0.1"));
    await tokenA.mint(wallet.address, web3.utils.toWei("1000"));

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  const amount = web3.utils.toWei("1");

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
