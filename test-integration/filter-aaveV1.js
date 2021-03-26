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
const AaveV1Filter = artifacts.require("AaveV1Filter");
const AaveETHTokenFilter = artifacts.require("AaveETHTokenFilter");
const IAaveV1LendingPool = artifacts.require("IAaveV1LendingPool");
const IAToken = artifacts.require("IAToken");
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
  let aaveETHTokenFilter;
  let dappRegistry;

  let uniswapRouter;

  let aaveLendingPool;
  let aToken;
  let tokenPriceRegistry;

  before(async () => {
    // Wire up AaveV1
    aaveLendingPool = await IAaveV1LendingPool.at("0x398eC7346DcD622eDc5ae82352F02bE94C62d119");
    aToken = await IAToken.at("0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04");

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
    filter = await AaveV1Filter.new();
    aaveETHTokenFilter = await AaveETHTokenFilter.new();
    await dappRegistry.addDapp(0, aaveLendingPool.address, filter.address);
    await dappRegistry.addDapp(0, aToken.address, aaveETHTokenFilter.address);
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
    beforeEach(async () => {
      const transactions = encodeCalls([
        [aaveLendingPool, "deposit", [AAVE_ETH_TOKEN, 1000, ""], 1000]
      ]);
      await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner]);
    });

    it("should allow redeem to wallet", async () => {
      const transactions = encodeCalls([
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
  });
});
