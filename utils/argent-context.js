const ethers = require("ethers");

const utils = require("./utilities.js");
const RelayManager = require("./relay-manager");

const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");

const { ETH_TOKEN } = utils;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const RECOVERY_PERIOD = 4;
const LOCK_PERIOD = 4;

class ArgentContext {
  constructor(accounts) {
    this.infrastructure = accounts[0];
    this.owner = accounts[1];
    this.guardian1 = accounts[2];
    this.relayer = accounts[4];
    this.refundAddress = accounts[7];
  }

  async initialize() {
    const moduleRegistry = await ModuleRegistry.new();
    const guardianStorage = await GuardianStorage.new();
    const transferStorage = await TransferStorage.new();
    this.dappRegistry = await DappRegistry.new(0);
    const uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    this.module = await ArgentModule.new(
      moduleRegistry.address,
      guardianStorage.address,
      transferStorage.address,
      this.dappRegistry.address,
      uniswapRouter,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD,
    );
    await moduleRegistry.registerModule(this.module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await this.dappRegistry.addDapp(0, this.relayer, ZERO_ADDRESS);

    const walletImplementation = await BaseWallet.new();
    this.factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      this.refundAddress,
    );
    await this.factory.addManager(this.infrastructure);
    this.manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
    return this;
  }

  async createFundedWallet(valueInEth = "0.1") {
    // create wallet
    const walletAddress = await utils.createWallet(
      this.factory.address,
      this.owner,
      [this.module.address],
      this.guardian1,
    );
    const wallet = await BaseWallet.at(walletAddress);

    // fund wallet
    await wallet.send(web3.utils.toWei(valueInEth));

    await utils.initNonce(wallet, this.module, this.manager, SECURITY_PERIOD);

    return wallet;
  };

  async multiCall(wallet, calls) {
    const encodedCalls = utils.encodeCalls(calls);
    return await this.multiCallRaw(wallet, encodedCalls);
  }

  async multiCallRaw(wallet, calls) {
    const txReceipt = await this.manager.relay(
      this.module,
      "multiCall",
      [wallet.address, calls],
      wallet,
      [this.owner],
      1,
      ETH_TOKEN,
      this.relayer,
    );
    return utils.parseRelayReceipt(txReceipt);
  }
}

module.exports = ArgentContext;
