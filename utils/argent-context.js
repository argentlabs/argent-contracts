/* global artifacts */

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
const ERC20 = artifacts.require("TestERC20");

const { ETH_TOKEN } = utils;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const RECOVERY_PERIOD = 4;
const LOCK_PERIOD = 4;

let erc20sTransferred = false;

class ArgentContext {
  constructor(accounts) {
    [
      this.infrastructure,
      this.owner,
      this.guardian1,
      , // eslint-disable-line
      this.relayer, // 4
      , // eslint-disable-line
      this.erc20sAddress, // 6
      this.refundAddress, // 7
    ] = accounts;
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

    this.DAI = await ERC20.at("0x6b175474e89094c44da98b954eedeac495271d0f");
    if (!erc20sTransferred) {
      this.transferERC20s();
      erc20sTransferred = true;
    }
    return this;
  }

  async createFundedWallet(tokens) {
    tokens = tokens || {};

    // create wallet
    const walletAddress = await utils.createWallet(
      this.factory.address,
      this.owner,
      [this.module.address],
      this.guardian1,
    );
    const wallet = await BaseWallet.at(walletAddress);

    // fund wallet in ETH
    await wallet.send(web3.utils.toWei(tokens.ETH || "0.1"));

    await utils.initNonce(wallet, this.module, this.manager, SECURITY_PERIOD);

    // optionally fund wallet in ERC-20's
    if (tokens.DAI) {
      await this.DAI.transfer(walletAddress, web3.utils.toWei(tokens.DAI), { from: this.erc20sAddress });
    }
    return wallet;
  }

  async multiCall(wallet, calls) {
    const encodedCalls = utils.encodeCalls(calls);
    return this.multiCallRaw(wallet, encodedCalls);
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

  async transferERC20s() {
    await this.DAI.transfer(this.erc20sAddress, web3.utils.toWei("10000"), { from: "0x6B175474E89094C44Da98b954EedeAC495271d0F" });
  }
}

module.exports = ArgentContext;
