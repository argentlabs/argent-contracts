/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2Factory");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01");
const WETH = artifacts.require("WETH9");

// Argent
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const Filter = artifacts.require("AaveV2Filter");
const AaveV2LendingPool = artifacts.require("AaveV2LendingPoolMock");
const ERC20 = artifacts.require("TestERC20");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");

// Utils

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, initNonce, encodeCalls } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

// Constants
const DECIMALS = 18; // number of decimal for TOKEN_A, TOKEN_B contracts

const RelayManager = require("../utils/relay-manager");

contract("Aave Filter", (accounts) => {
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
  let aave;
  let tokenPriceRegistry;

  before(async () => {
    // Deploy test tokens
    tokenA = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);

    // Deploy AaveV2
    aave = await AaveV2LendingPool.new([tokenA.address]);

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const weth = await WETH.new();
    uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);

    // deploy Argent
    registry = await Registry.new();
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.setTradableForTokenList([tokenA.address], [true]);
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
    await dappRegistry.addDapp(0, aave.address, filter.address);
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
    await wallet.send(web3.utils.toWei("0.1"));
    await tokenA.mint(wallet.address, web3.utils.toWei("1000"));
  });

  describe("Aave V2", () => {
    beforeEach(async () => {
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

    const deposit = async (beneficiary) => multiCall(encodeCalls([
      [tokenA, "approve", [aave.address, amount]],
      [aave, "deposit", [tokenA.address, amount, beneficiary, ""]]
    ]));

    const withdraw = async (beneficiary) => multiCall(encodeCalls([
      [aave, "withdraw", [tokenA.address, amount, beneficiary]]
    ]));

    it("should allow deposits on behalf of wallet", async () => {
      const { success, error } = await deposit(wallet.address);
      assert.isTrue(success, `deposit failed: "${error}"`);
    });

    it("should not allow deposits on behalf of non-wallet", async () => {
      const { success, error } = await deposit(infrastructure);
      assert.isFalse(success, "deposit should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should allow withdrawals to wallet", async () => {
      await deposit(wallet.address);
      const { success, error } = await withdraw(wallet.address);
      assert.isTrue(success, `withdraw failed: "${error}"`);
    });

    it("should not allow withdrawals to non-wallet", async () => {
      await deposit(wallet.address);
      const { success, error } = await withdraw(infrastructure);
      assert.isFalse(success, "withdraw should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not allow direct transfers to lending pool", async () => {
      const { success, error } = await multiCall(encodeCalls([
        [tokenA, "transfer", [aave.address, amount]],
      ]));
      assert.isFalse(success, "transfer should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not allow calling forbidden lending pool methods", async () => {
      const { success, error } = await multiCall(encodeCalls([
        [aave, "borrow", [tokenA.address, amount, 0, 0, wallet.address]]
      ]));
      assert.isFalse(success, "borrow should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });
});
