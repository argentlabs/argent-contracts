/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
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
const ILido = artifacts.require("ILido");

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2Factory");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01");
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
  let filter;
  let dappRegistry;
  let uniswapRouter;

  let lido;

  before(async () => {
    // Lido contract on mainnet
    lido = await ILido.at("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");

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
    filter = await LidoFilter.new();
    await dappRegistry.addDapp(0, lido.address, filter.address);
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
      assert.equal(walletBalance.toNumber(), 99);
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
      assert.equal(walletBalance.toNumber(), 99);
    });

    it("should not allow calling forbidden staking pool methods", async () => {
      const data = lido.contract.methods.approve(accounts[5], 10).encodeABI();
      const transaction = encodeTransaction(lido.address, 0, data);

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
      assert.isFalse(success);
      assert.equal(error, "TM: call not authorised");
    });
  });
});
