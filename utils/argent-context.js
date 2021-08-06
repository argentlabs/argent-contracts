/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");
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
const WETH = artifacts.require("WETH9");
const IUSDCToken = artifacts.require("IUSDCToken");

const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const RECOVERY_PERIOD = 4;
const LOCK_PERIOD = 4;

chai.use(bnChai(BN));

let tokensFunded = false;

class ArgentContext {
  constructor(accounts) {
    [
      this.infrastructure,
      this.owner,
      this.guardian1,
      , // eslint-disable-line
      this.relayer, // 4
      , // eslint-disable-line
      this.tokenHolder, // 6
      this.refundAddress, // 7
    ] = accounts;
  }

  async initialise() {
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
    await this.dappRegistry.addDapp(0, this.relayer, utils.ZERO_ADDRESS);

    const walletImplementation = await BaseWallet.new();
    this.factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      this.refundAddress,
    );
    await this.factory.addManager(this.infrastructure);
    this.manager = new RelayManager(guardianStorage.address, utils.ZERO_ADDRESS);

    await this.initialiseTokens();
    return this;
  }

  async initialiseTokens() {
    this.WETH = await WETH.at("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    this.DAI = await ERC20.at("0x6b175474e89094c44da98b954eedeac495271d0f");
    this.USDC = await IUSDCToken.at("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

    if (tokensFunded) {
      return;
    }

    // transfer tokens from mainnet whale addresses to a test address we control
    try {
      await this.WETH.transfer(this.tokenHolder, web3.utils.toWei("10000"), { from: "0x2F0b23f53734252Bda2277357e97e1517d6B042A" });
      await this.DAI.transfer(this.tokenHolder, web3.utils.toWei("1000000"), { from: "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643" });
    } catch (error) {
      if (error.toString().includes("transfer amount exceeds balance")) {
        console.error("!!!!!!!!!!!!!!!!!!!!!");
        console.error("One of the ERC-20 whales doesn't have enough balance on mainnet to use their tokens.");
        console.error("Either find another whale with enough funds, or use the token's minter.");
        console.error("!!!!!!!!!!!!!!!!!!!!!");
        console.error("");
      }
    }

    // mint $1b USDC
    await this.USDC.configureMinter(this.infrastructure, web3.utils.toWei("10000000"), { from: "0xe982615d461dd5cd06575bbea87624fda4e3de17" });
    await this.USDC.mint(this.tokenHolder, web3.utils.toWei("10000000"));

    tokensFunded = true;
  }

  async createFundedWallet(amounts = {}) {
    // create wallet
    const walletAddress = await utils.createWallet(
      this.factory.address,
      this.owner,
      [this.module.address],
      this.guardian1,
    );
    const wallet = await BaseWallet.at(walletAddress);

    // fund wallet in ETH
    await wallet.send(amounts.ETH || web3.utils.toWei("0.1"));

    await utils.initNonce(wallet, this.module, this.manager, SECURITY_PERIOD);

    // optionally fund wallet in ERC-20's
    for (const ticker of ["WETH", "DAI", "USDC"]) {
      const amount = amounts[ticker];
      if (amount) {
        await this[ticker].transfer(walletAddress, amount, { from: this.tokenHolder });
      }
    }
    return wallet;
  }

  async multiCall(wallet, calls, { gasPrice = 1 } = {}) {
    const receipt = await this.manager.relay(
      this.module,
      "multiCall",
      [wallet.address, utils.encodeCalls(calls)],
      wallet,
      [this.owner],
      gasPrice,
      utils.ETH_TOKEN,
      this.relayer,
    );
    const result = utils.parseRelayReceipt(receipt);
    return { ...result, receipt };
  }

  async tokenBalances() {
    return {
      WETH: web3.utils.fromWei(await this.WETH.balanceOf(this.tokenHolder)),
      DAI: web3.utils.fromWei(await this.DAI.balanceOf(this.tokenHolder)),
      USDC: (await this.USDC.balanceOf(this.tokenHolder)).toString().slice(0, -6),
    };
  }
}

// transfer tokens during global setup otherwise they get reverted by snapshots between tests
before(async () => {
  const accounts = await web3.eth.getAccounts();
  await new ArgentContext(accounts).initialiseTokens();
});

module.exports = ArgentContext;
