/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

// Argent
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const LidoFilter = artifacts.require("LidoFilter");
const CurveFilter = artifacts.require("CurveFilter");
const ILido = artifacts.require("ILido");
const ICurvePool = artifacts.require("ICurvePool");

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");
const WETH = artifacts.require("WETH9");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, initNonce, encodeTransaction } = require("../utils/utilities.js");

const ZERO_BYTES = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("Lido Filter", (accounts) => {
  let manager;

  const owner = accounts[1];
  const relayer = accounts[4];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let lidoFilter;
  let curveFilter;
  let dappRegistry;
  let uniswapRouter;

  let lido;
  let curve;

  before(async () => {
    // Lido contract on mainnet
    lido = await ILido.at("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
    curve = await ICurvePool.at("0xdc24316b9ae028f1497c275eb9192a3ea0f67022");

    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const weth = await WETH.new();
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
    lidoFilter = await LidoFilter.new();
    curveFilter = await CurveFilter.new();
    await dappRegistry.addDapp(0, lido.address, lidoFilter.address);
    await dappRegistry.addDapp(0, curve.address, curveFilter.address);
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

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  describe("Lido staking", () => {
    it("should allow staking from wallet via fallback", async () => {
      const transaction = encodeTransaction(lido.address, 100, ZERO_BYTES);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await lido.balanceOf(wallet.address);
      expect(walletBalance).to.eq.BN(99);
    });

    it("should allow staking from wallet via submit", async () => {
      const data = lido.contract.methods.submit(accounts[5]).encodeABI();
      const transaction = encodeTransaction(lido.address, 100, data);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await lido.balanceOf(wallet.address);
      expect(walletBalance).to.eq.BN(99);
    });
  });

  describe("Selling via CurvePool", () => {
    beforeEach(async () => {
      // Stake some funds to use to test selling
      const data = lido.contract.methods.submit(accounts[5]).encodeABI();
      const transaction = encodeTransaction(lido.address, 100, data);

      await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
    });

    it("should allow selling stETH via Curve", async () => {
      const transactions = [];
      let data = lido.contract.methods.approve(curve.address, 99).encodeABI();
      let transaction = encodeTransaction(lido.address, 0, data);
      transactions.push(transaction);
      data = curve.contract.methods.exchange(1, 0, 99, 95).encodeABI();
      transaction = encodeTransaction(curve.address, 0, data);
      transactions.push(transaction);

      const before = await utils.getBalance(wallet.address);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `exchange failed: "${error}"`);

      const event = await utils.getEvent(txReceipt, curve, "TokenExchange");
      assert.equal(event.args.tokens_sold, 99); // Sold stETH
      assert.closeTo(new BN(event.args.tokens_bought).toNumber(), new BN(96).toNumber(), 1); // Got ETH
      // Check ETH was received
      const after = await utils.getBalance(wallet.address);
      assert.closeTo(after.sub(before).toNumber(), 96, 1);

      // Check only dust stETH left
      const walletBalance = await lido.balanceOf(wallet.address);
      expect(walletBalance).to.eq.BN(1);
    });
  });
});
