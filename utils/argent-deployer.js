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
const WETH9 = artifacts.require("WETH9");
const IUSDCToken = artifacts.require("IUSDCToken");
const TetherToken = artifacts.require("TetherToken");

const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const RECOVERY_PERIOD = 4;
const LOCK_PERIOD = 4;

chai.use(bnChai(BN));

let tokensFunded = false;

const fundTokens = async (tokenHolder, infrastructure) => {
  const WETH = await WETH9.at("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  const stETH = await ERC20.at("0xae7ab96520de3a18e5e111b5eaab095312d7fe84");
  const DAI = await ERC20.at("0x6b175474e89094c44da98b954eedeac495271d0f");
  const USDC = await IUSDCToken.at("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  const USDT = await TetherToken.at("0xdAC17F958D2ee523a2206206994597C13D831ec7");
  const sUSD = await ERC20.at("0x57Ab1ec28D129707052df4dF418D58a2D46d5f51");

  if (!tokensFunded) {
    // transfer tokens from mainnet whale addresses to the tokenHolder account
    await WETH.transfer(tokenHolder, web3.utils.toWei("10000"), { from: "0x2F0b23f53734252Bda2277357e97e1517d6B042A" });
    await stETH.transfer(tokenHolder, web3.utils.toWei("100"), { from: "0xa2f987a546d4cd1c607ee8141276876c26b72bdf" });
    await DAI.transfer(tokenHolder, web3.utils.toWei("1000000"), { from: "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643" });
    await sUSD.transfer(tokenHolder, web3.utils.toWei("1000000"), { from: "0x6c5024cd4f8a59110119c56f8933403a539555eb" });

    // mint USDC
    await USDC.configureMinter(infrastructure, web3.utils.toWei("10000000"), { from: "0xe982615d461dd5cd06575bbea87624fda4e3de17" });
    await USDC.mint(tokenHolder, web3.utils.toWei("10000000"));

    // mint USDT
    await USDT.issue(web3.utils.toWei("1000000"), { from: "0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828" });
    await USDT.transfer(tokenHolder, web3.utils.toWei("1000000"), { from: "0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828" });

    tokensFunded = true;
  }

  return { WETH, stETH, DAI, USDC, USDT, sUSD };
};

module.exports.deployArgent = async (accounts) => {
  const [infrastructure, owner, guardian1, relayer, tokenHolder, refundAddress, ...freeAccounts] = accounts;

  const moduleRegistry = await ModuleRegistry.new();
  const guardianStorage = await GuardianStorage.new();
  const transferStorage = await TransferStorage.new();
  const dappRegistry = await DappRegistry.new(0);
  const uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const module = await ArgentModule.new(
    moduleRegistry.address,
    guardianStorage.address,
    transferStorage.address,
    dappRegistry.address,
    uniswapRouter,
    SECURITY_PERIOD,
    SECURITY_WINDOW,
    RECOVERY_PERIOD,
    LOCK_PERIOD,
  );
  await moduleRegistry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
  await dappRegistry.addDapp(0, relayer, utils.ZERO_ADDRESS);

  const baseWallet = await BaseWallet.new();
  const walletFactory = await WalletFactory.new(
    baseWallet.address,
    guardianStorage.address,
    refundAddress,
  );
  await walletFactory.addManager(infrastructure);
  const manager = new RelayManager(guardianStorage.address, utils.ZERO_ADDRESS);
  const tokens = await fundTokens(tokenHolder, infrastructure);

  const multiCall = async (wallet, calls, { gasPrice = 1 } = {}) => {
    const receipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, utils.encodeCalls(calls)],
      wallet,
      [owner],
      gasPrice,
      utils.ETH_TOKEN,
      relayer,
    );
    const result = utils.parseRelayReceipt(receipt);
    return { ...result, receipt };
  };

  const createFundedWallet = async (amounts = {}) => {
    // create wallet
    const walletAddress = await utils.createWallet(
      walletFactory.address,
      owner,
      [module.address],
      guardian1,
    );
    const wallet = await BaseWallet.at(walletAddress);

    // fund wallet in ETH
    await wallet.send(amounts.ETH || web3.utils.toWei("0.1"));

    await utils.initNonce(wallet, module, manager, SECURITY_PERIOD);

    // optionally fund wallet in ERC-20's
    for (const [ticker, amount] of Object.entries(amounts)) {
      if (ticker !== "ETH") {
        const token = tokens[ticker];
        if (!token) {
          throw new Error(`Unsupported ERC-20 token: ${ticker}`);
        }
        await token.transfer(walletAddress, amount.toString(), { from: tokenHolder });
      }
    }

    return wallet;
  };

  const tokenBalances = async () => ({
    WETH: web3.utils.fromWei(await tokens.WETH.balanceOf(tokenHolder)),
    stETH: web3.utils.fromWei(await tokens.stETH.balanceOf(tokenHolder)),
    DAI: web3.utils.fromWei(await tokens.DAI.balanceOf(tokenHolder)),
    USDC: (await tokens.USDC.balanceOf(tokenHolder)).toString().slice(0, -6),
    USDT: web3.utils.fromWei(await tokens.USDT.balanceOf(tokenHolder)),
    sUSD: web3.utils.fromWei(await tokens.sUSD.balanceOf(tokenHolder)),
  });

  return {
    infrastructure,
    owner,
    freeAccounts,
    module,
    manager,
    dappRegistry,
    ...tokens,
    createFundedWallet,
    multiCall,
    tokenBalances,
  };
};

// transfer tokens during global setup otherwise they get reverted by snapshots between tests
before(async () => {
  const accounts = await web3.eth.getAccounts();
  await fundTokens(accounts[6], accounts[0]);
});
