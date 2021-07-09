require("chai");
const ethers = require("ethers");

const utils = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const WethFilter = artifacts.require("WethFilter")
const WETH = artifacts.require("WETH9");
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");

const { ETH_TOKEN, initNonce, encodeTransaction } = utils;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const RECOVERY_PERIOD = 4;
const LOCK_PERIOD = 4;

contract("WETH Filter", accounts => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const relayer = accounts[4];
  const refundAddress = accounts[7];

  let weth;
  let moduleRegistry;
  let dappRegistry;
  let guardianStorage;
  let transferStorage;
  let module;
  let wallet;
  let factory;
  let manager;

  before(async () => {
    weth = await WETH.at("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);
    // const uniswapRouter = await UniswapV2Router01.at("..."); // possible?

    // deploy Argent
    moduleRegistry = await ModuleRegistry.new();
    dappRegistry = await DappRegistry.new(0);
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    module = await ArgentModule.new(
      moduleRegistry.address,
      guardianStorage.address,
      transferStorage.address,
      dappRegistry.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);
    await moduleRegistry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    const wethFilter = await WethFilter.new();
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

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  describe("WETH deposit and withdrawal", () => {
    it("should allow depositing ETH and getting back WETH", async () => {
      const data = weth.contract.methods.deposit().encodeABI();
      const transaction = encodeTransaction(weth.address, 100, data);

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

      const walletBalance = await weth.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("100");
    });
  });

});
