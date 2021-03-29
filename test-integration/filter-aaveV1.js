/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

const { expect } = require("chai");
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
const AaveV1LendingPoolFilter = artifacts.require("AaveV1LendingPoolFilter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const AaveV1ATokenFilter = artifacts.require("AaveV1ATokenFilter");
const IAaveV1LendingPool = artifacts.require("IAaveV1LendingPool");
const IAToken = artifacts.require("IAToken");
const IUSDCToken = artifacts.require("IUSDCToken");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");

// Utils
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, initNonce, encodeCalls } = require("../utils/utilities.js");

const AAVE_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("AaveV1 Filter", (accounts) => {
  let manager;

  const owner = accounts[1];
  const relayer = accounts[4];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let filter;
  let aTokenFilter;
  let dappRegistry;

  let uniswapRouter;

  let aaveLendingPool;
  let aaveLendingPoolCore;
  let aToken;
  let usdcToken;
  let aUSDCToken;
  let tokenPriceRegistry;

  before(async () => {
    // Wire up AaveV1
    aaveLendingPoolCore = "0x3dfd23A6c5E8BbcFc9581d2E864a68feb6a076d3";
    aaveLendingPool = await IAaveV1LendingPool.at("0x398eC7346DcD622eDc5ae82352F02bE94C62d119");
    aToken = await IAToken.at("0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04");
    usdcToken = await IUSDCToken.at("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    aUSDCToken = await IAToken.at("0x9ba00d6856a4edf4665bca2c2309936572473b7e");

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const weth = await WETH.new();
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
    filter = await AaveV1LendingPoolFilter.new();
    aTokenFilter = await AaveV1ATokenFilter.new();
    const approveFilter = await OnlyApproveFilter.new();
    await dappRegistry.addDapp(0, aaveLendingPoolCore, approveFilter.address);
    await dappRegistry.addDapp(0, aaveLendingPool.address, filter.address);
    await dappRegistry.addDapp(0, aToken.address, aTokenFilter.address);
    await dappRegistry.addDapp(0, aUSDCToken.address, aTokenFilter.address);
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
    await wallet.send(10000000);

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  describe("deposit", () => {
    it("should allow deposits of ETH on behalf of wallet", async () => {
      const transactions = encodeCalls([
        [aaveLendingPool, "deposit", [AAVE_ETH_TOKEN, 1000, ""], 1000]
      ]);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const event = await utils.getEvent(txReceipt, aaveLendingPool, "Deposit");
      assert.equal(event.args._reserve, AAVE_ETH_TOKEN);
      assert.equal(event.args._user, wallet.address);
      assert.equal(event.args._amount, 1000);

      const balance = await aToken.balanceOf(wallet.address);
      expect(balance).to.eq.BN(1000);
    });

    it("should allow deposits of ERC20 on behalf of wallet", async () => {
      // Fund the wallet with 1000 USDC tokens
      const masterMinter = "0xe982615d461dd5cd06575bbea87624fda4e3de17";
      await usdcToken.configureMinter(accounts[0], web3.utils.toWei("10000"), { from: masterMinter });
      await usdcToken.mint(wallet.address, 1000);
      const usdcTokenBalance = await usdcToken.balanceOf(wallet.address);
      expect(usdcTokenBalance).to.eq.BN(1000);

      const transactions = encodeCalls([
        [usdcToken, "approve", [aaveLendingPoolCore, 1000]],
        [aaveLendingPool, "deposit", [usdcToken.address, 1000, ""]]
      ]);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const event = await utils.getEvent(txReceipt, aaveLendingPool, "Deposit");
      assert.equal(event.args._reserve, usdcToken.address);
      assert.equal(event.args._user, wallet.address);
      assert.equal(event.args._amount, 1000);

      const balance = await aUSDCToken.balanceOf(wallet.address);
      expect(balance).to.eq.BN(1000);
    });

    it("should not allow calling forbidden lending pool methods", async () => {
      const transactions = encodeCalls([
        [aaveLendingPool, "borrow", [aToken.address, 10, 0, 0]]
      ]);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "borrow should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  describe("redeem", () => {
    it("should allow redeem of ETH to wallet", async () => {
      // Fund the wallet with 1000 wei and deposit them to Aave
      let transactions = encodeCalls([
        [aaveLendingPool, "deposit", [AAVE_ETH_TOKEN, 1000, ""], 1000]
      ]);
      await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner]);

      // Redeem the 1000 wei tokens
      transactions = encodeCalls([
        [aToken, "redeem", [1000], 0]
      ]);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `redeem failed: "${error}"`);

      const event = await utils.getEvent(txReceipt, aToken, "Redeem");
      assert.equal(event.args._from, wallet.address);
      assert.equal(event.args._value, 1000);
    });

    it("should allow redeem of ERC20 to wallet", async () => {
      // Fund the wallet with 1000 USDC tokens and deposit them to Aave
      const masterMinter = "0xe982615d461dd5cd06575bbea87624fda4e3de17";
      await usdcToken.configureMinter(accounts[0], web3.utils.toWei("10000"), { from: masterMinter });
      await usdcToken.mint(wallet.address, 1000);
      const usdcTokenBalance = await usdcToken.balanceOf(wallet.address);
      expect(usdcTokenBalance).to.eq.BN(1000);

      let transactions = encodeCalls([
        [usdcToken, "approve", [aaveLendingPoolCore, 1000]],
        [aaveLendingPool, "deposit", [usdcToken.address, 1000, ""]]
      ]);

      await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      // Redeem the 1000 aUSDC tokens
      transactions = encodeCalls([
        [aUSDCToken, "redeem", [1000], 0]
      ]);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `redeem failed: "${error}"`);

      const event = await utils.getEvent(txReceipt, aUSDCToken, "Redeem");
      assert.equal(event.args._from, wallet.address);
      assert.equal(event.args._value, 1000);
    });
  });
});
