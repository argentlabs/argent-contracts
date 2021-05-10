/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
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
const ZkSyncFilter = artifacts.require("ZkSyncFilter");

// ZkSync
const ERC20 = artifacts.require("TestERC20");
const ZkSync = artifacts.require("ZkSyncMock");
const ZkGov = artifacts.require("GovernanceMock");

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

contract("ZkSync deposits/withdrawals", (accounts) => {
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
  let erc20;

  let zk;
  let zkGov;

  before(async () => {
    // Deploy test token
    weth = await WETH.new();
    erc20 = await ERC20.new([infrastructure], web3.utils.toWei("1000"), 18);

    // Deploy and setup ZkSync
    zk = await ZkSync.new();
    const govParams = web3.eth.abi.encodeParameter("address", accounts[0]);
    zkGov = await ZkGov.new();
    await zkGov.initialize(govParams);
    await zkGov.addToken(erc20.address);
    const zkParams = web3.eth.abi.encodeParameters(
      ["address", "address", "bytes32"],
      [zkGov.address, accounts[0], "0x"]
    );
    await zk.initialize(zkParams);

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
    const zkFilter = await ZkSyncFilter.new(false);
    await dappRegistry.addDapp(0, zk.address, zkFilter.address);
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
    await erc20.transfer(wallet.address, web3.utils.toWei("1"));

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

  const depositERC20 = async () => multiCall(encodeCalls([
    [erc20, "approve", [zk.address, AMOUNT]],
    [zk, "depositERC20", [erc20.address, AMOUNT, wallet.address]]
  ]));

  const depositETH = async () => multiCall(encodeCalls([
    [zk, "depositETH", [wallet.address], AMOUNT]
  ]));

  const withdrawERC20 = async () => multiCall(encodeCalls([
    [zk, "withdrawPendingBalance", [wallet.address, erc20.address, AMOUNT]]
  ]));

  it("should allow ERC20 deposits", async () => {
    const zkBalanceBefore = await erc20.balanceOf(zk.address);
    const walletBalanceBefore = await erc20.balanceOf(wallet.address);
    const { success, error } = await depositERC20();
    assert.isTrue(success, `deposit failed: "${error}"`);
    const zkBalanceAfter = await erc20.balanceOf(zk.address);
    const walletBalanceAfter = await erc20.balanceOf(wallet.address);
    expect(zkBalanceAfter.sub(zkBalanceBefore)).to.be.eq.BN(AMOUNT);
    expect(walletBalanceBefore.sub(walletBalanceAfter)).to.be.eq.BN(AMOUNT);
  });

  it("should allow ETH deposits", async () => {
    const zkBalanceBefore = new BN(await web3.eth.getBalance(zk.address));
    const walletBalanceBefore = new BN(await web3.eth.getBalance(wallet.address));
    const { success, error } = await depositETH();
    assert.isTrue(success, `depositETH failed: "${error}"`);
    const zkBalanceAfter = new BN(await web3.eth.getBalance(zk.address));
    const walletBalanceAfter = new BN(await web3.eth.getBalance(wallet.address));
    expect(zkBalanceAfter.sub(zkBalanceBefore)).to.be.eq.BN(AMOUNT);
    expect(walletBalanceBefore.sub(walletBalanceAfter)).to.be.gte.BN(AMOUNT);
  });

  it("should allow withdrawals", async () => {
    await depositERC20();
    const { success, error } = await withdrawERC20();
    assert.isTrue(success, `withdraw failed: "${error}"`);
  });

  it("should not allow direct transfers to ZkSync", async () => {
    const { success, error } = await multiCall(encodeCalls([[erc20, "transfer", [zk.address, AMOUNT]]]));
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method", async () => {
    const { success, error } = await multiCall(encodeCalls([[zk, "initialize", ["0x"]]]));
    assert.isFalse(success, "unsupported method should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH", async () => {
    const { success, error } = await multiCall([encodeTransaction(zk.address, AMOUNT, "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
