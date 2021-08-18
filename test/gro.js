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

// Gro
const DepositHandler = artifacts.require("DepositHandlerMock");
const WithdrawHandler = artifacts.require("WithdrawHandlerMock");
const ERC20 = artifacts.require("TestERC20");

// Argent
const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const DepositFilter = artifacts.require("GroDepositFilter");
const WithdrawFilter = artifacts.require("GroWithdrawFilter");

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

contract("Gro Filter", (accounts) => {
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

  let weth;
  let tokenA;

  let depositHandler;
  let withdrawHandler;

  before(async () => {
    // Deploy test token
    weth = await WETH.new();
    tokenA = await ERC20.new([infrastructure], web3.utils.toWei("1000"), 18);

    // Deploy Gro
    depositHandler = await DepositHandler.new();
    withdrawHandler = await WithdrawHandler.new();

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
    const depositFilter = await DepositFilter.new();
    const withdrawFilter = await WithdrawFilter.new();

    await dappRegistry.addDapp(0, depositHandler.address, depositFilter.address);
    await dappRegistry.addDapp(0, withdrawHandler.address, withdrawFilter.address);
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
    await tokenA.mint(wallet.address, web3.utils.toWei("1000"));

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

  const depositGvt = async () => multiCall(encodeCalls([
    [tokenA, "approve", [depositHandler.address, AMOUNT]],
    [depositHandler, "depositGvt", [[AMOUNT, 0, 0], 1, ZERO_ADDRESS]]
  ]));
  const depositPwrd = async () => multiCall(encodeCalls([
    [tokenA, "approve", [depositHandler.address, AMOUNT]],
    [depositHandler, "depositPwrd", [[AMOUNT, 0, 0], 1, ZERO_ADDRESS]]
  ]));

  const withdrawByLPToken = async () => multiCall(encodeCalls([
    [withdrawHandler, "withdrawByLPToken", [true, AMOUNT, [1, 1, 1]]]
  ]));
  const withdrawByStablecoin = async () => multiCall(encodeCalls([
    [withdrawHandler, "withdrawByStablecoin", [true, 0, AMOUNT, 1]]
  ]));
  const withdrawAllSingle = async () => multiCall(encodeCalls([
    [withdrawHandler, "withdrawAllSingle", [true, 0, 1]]
  ]));
  const withdrawAllBalanced = async () => multiCall(encodeCalls([
    [withdrawHandler, "withdrawAllBalanced", [true, [1, 1, 1]]]
  ]));

  it("should allow deposits (1/2)", async () => {
    const { success, error } = await depositGvt();
    assert.isTrue(success, `deposit1 failed: "${error}"`);
  });
  it("should allow deposits (2/2)", async () => {
    const { success, error } = await depositPwrd();
    assert.isTrue(success, `deposit2 failed: "${error}"`);
  });

  it("should allow withdrawals (1/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawByLPToken();
    assert.isTrue(success, `withdraw1 failed: "${error}"`);
  });
  it("should allow withdrawals (2/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawByStablecoin();
    assert.isTrue(success, `withdraw2 failed: "${error}"`);
  });
  it("should allow withdrawals (3/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawAllSingle();
    assert.isTrue(success, `withdraw3 failed: "${error}"`);
  });
  it("should allow withdrawals (4/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawAllBalanced();
    assert.isTrue(success, `withdraw4 failed: "${error}"`);
  });

  it("should not allow direct transfers to deposit handler", async () => {
    const { success, error } = await multiCall(encodeCalls([[weth, "transfer", [depositHandler.address, AMOUNT]]]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow direct transfers to withdraw handler", async () => {
    const { success, error } = await multiCall(encodeCalls([[weth, "transfer", [withdrawHandler.address, AMOUNT]]]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method (deposit handler)", async () => {
    const { success, error } = await multiCall(encodeCalls([[depositHandler, "referral", [ZERO_ADDRESS]]]));
    assert.isFalse(success, "referral() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method (withdraw handler)", async () => {
    const { success, error } = await multiCall(encodeCalls([[withdrawHandler, "withdrawalFee", [true]]]));
    assert.isFalse(success, "withdrawalFee() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to deposit handler", async () => {
    const { success, error } = await multiCall([encodeTransaction(depositHandler.address, AMOUNT, "0x")]);
    assert.isFalse(success, "sending ETH to deposit handler should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to withdraw handler", async () => {
    const { success, error } = await multiCall([encodeTransaction(withdrawHandler.address, AMOUNT, "0x")]);
    assert.isFalse(success, "sending ETH to withdrawal handler should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
