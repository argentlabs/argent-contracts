/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect, assert } = chai;
chai.use(bnChai(BN));

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");
const WETH = artifacts.require("WETH9");
const UniZap = artifacts.require("UniZap");

// Argent
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const ERC20 = artifacts.require("TestERC20");
const UniZapFilter = artifacts.require("UniswapV2UniZapFilter");

// Utils
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, assertFailedWithError } = require("../utils/utilities.js");

const ZERO_BYTES = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("ArgentModule", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const recipient = accounts[4];
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let filter;
  let dappRegistry;
  let uniswapRouter;
  let token;
  let weth;
  let lpToken;
  let uniZap;

  before(async () => {
    // Deploy and mint test tokens
    token = await ERC20.new([infrastructure], web3.utils.toWei("100"), 18);
    weth = await WETH.new();
    await weth.send(web3.utils.toWei("1"));

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);
    await token.approve(uniswapRouter.address, web3.utils.toWei("3"));
    await weth.approve(uniswapRouter.address, web3.utils.toWei("1"));
    const timestamp = await utils.getTimestamp();
    // add liquidity
    await uniswapRouter.addLiquidity(
      token.address,
      weth.address,
      web3.utils.toWei("3"),
      web3.utils.toWei("1"),
      1,
      1,
      infrastructure,
      timestamp + 300,
    );
    // get LP Token address
    lpToken = await ERC20.at(await uniswapFactory.getPair(weth.address, token.address));

    // deploy UniZap
    uniZap = await UniZap.new(uniswapFactory.address, uniswapRouter.address, weth.address);

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

    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);

    filter = await UniZapFilter.new();
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniZap.address, filter.address);
  });

  beforeEach(async () => {
    // create wallet
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    // fund wallet
    await wallet.send(web3.utils.toWei("1"));
    await token.mint(wallet.address, web3.utils.toWei("10"));
  });

  async function getBalance(tokenAddress, _wallet) {
    let balance;
    if (tokenAddress === ETH_TOKEN) {
      balance = await utils.getBalance(_wallet.address);
    } else if (tokenAddress === token.address) {
      balance = await token.balanceOf(_wallet.address);
    } else {
      balance = await lpToken.balanceOf(_wallet.address);
    }
    return balance;
  }

  async function addLiquidity(tokenAddress, amount, to) {
    const transactions = [];
    const balancesBefore = [];
    const balancesAfter = [];
    const deadline = (await utils.getTimestamp()) + 10;

    if (tokenAddress === ETH_TOKEN) {
      const data = uniZap.contract.methods.swapExactETHAndAddLiquidity(token.address, 0, to, deadline).encodeABI();
      transactions.push(encodeTransaction(uniZap.address, amount, data));
      balancesBefore.push(await getBalance(ETH_TOKEN, wallet));
    } else {
      let data = token.contract.methods.approve(uniZap.address, amount).encodeABI();
      transactions.push(encodeTransaction(token.address, 0, data));
      data = uniZap.contract.methods.swapExactTokensAndAddLiquidity(token.address, weth.address, amount, 0, to, deadline).encodeABI();
      transactions.push(encodeTransaction(uniZap.address, 0, data));
      balancesBefore.push(await getBalance(token.address, wallet));
    }

    balancesBefore.push(await getBalance(lpToken.address, wallet));
    const txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, transactions],
      wallet,
      [owner]);
    const { success } = await utils.parseRelayReceipt(txReceipt);
    if (success) {
      if (tokenAddress === ETH_TOKEN) {
        balancesAfter.push(await getBalance(ETH_TOKEN, wallet));
      } else {
        balancesAfter.push(await getBalance(token.address, wallet));
      }
      balancesAfter.push(await getBalance(lpToken.address, wallet));
      expect(balancesBefore[0].sub(balancesAfter[0])).to.gt.BN(0); // should have send weth/token
      expect(balancesBefore[1].sub(balancesAfter[1])).to.lt.BN(0); // should have received lp token
    }

    return txReceipt;
  }

  async function removeLiquidity(tokenAddress, amount, to) {
    const transactions = [];
    const balancesBefore = [];
    const balancesAfter = [];
    const deadline = (await utils.getTimestamp()) + 10;

    let data = lpToken.contract.methods.approve(uniZap.address, amount).encodeABI();
    transactions.push(encodeTransaction(lpToken.address, 0, data));
    if (tokenAddress === ETH_TOKEN) {
      data = uniZap.contract.methods.removeLiquidityAndSwapToETH(token.address, amount, 0, to, deadline).encodeABI();
      transactions.push(encodeTransaction(uniZap.address, 0, data));
      balancesBefore.push(await getBalance(ETH_TOKEN, wallet));
    } else {
      data = uniZap.contract.methods.removeLiquidityAndSwapToToken(weth.address, token.address, amount, 0, to, deadline).encodeABI();
      transactions.push(encodeTransaction(uniZap.address, 0, data));
      balancesBefore.push(await getBalance(token.address, wallet));
    }

    balancesBefore.push(await getBalance(lpToken.address, wallet));
    const txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, transactions],
      wallet,
      [owner]);
    const { success } = await utils.parseRelayReceipt(txReceipt);
    if (success) {
      if (tokenAddress === ETH_TOKEN) {
        balancesAfter.push(await getBalance(ETH_TOKEN, wallet));
      } else {
        balancesAfter.push(await getBalance(token.address, wallet));
      }
      balancesAfter.push(await getBalance(lpToken.address, wallet));
      expect(balancesBefore[0].sub(balancesAfter[0])).to.lt.BN(0); // should have received weth/token
      expect(balancesBefore[1].sub(balancesAfter[1])).to.gt.BN(0); // should have burn lp tokens
    }

    return txReceipt;
  }

  describe("UniZap methods", () => {
    it("should add liquidity with ETH", async () => {
      await addLiquidity(ETH_TOKEN, web3.utils.toWei("1", "finney"), wallet.address);
    });

    it("should add liquidity with token", async () => {
      await addLiquidity(token, web3.utils.toWei("1", "finney"), wallet.address);
    });

    it("should block adding liquidity when the recipient is not the wallet", async () => {
      const txReceipt = await addLiquidity(token, web3.utils.toWei("1", "finney"), recipient);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });

    it("should remove liquidity to ETH", async () => {
      await addLiquidity(ETH_TOKEN, web3.utils.toWei("1", "finney"), wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      await removeLiquidity(ETH_TOKEN, lpBalance.div(new BN(2)).toString(), wallet.address);
    });

    it("should remove liquidity to token", async () => {
      await addLiquidity(ETH_TOKEN, web3.utils.toWei("1", "finney"), wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      await removeLiquidity(token.address, lpBalance.div(new BN(2)).toString(), wallet.address);
    });

    it("should block removing liquidity when the recipient is not the wallet", async () => {
      await addLiquidity(ETH_TOKEN, web3.utils.toWei("1", "finney"), wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      const txReceipt = await removeLiquidity(token.address, lpBalance.div(new BN(2)).toString(), recipient);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });
  });

  describe("ETH and ERC20 methods", () => {
    it("should block sending ETH to the zap", async () => {
      const transaction = await encodeTransaction(uniZap.address, web3.utils.toWei("1", "finney"), ZERO_BYTES);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });

    it("should block sending an ERC20 to the zap", async () => {
      const data = token.contract.methods.transfer(uniZap.address, web3.utils.toWei("1", "finney")).encodeABI();
      const transaction = encodeTransaction(token.address, 0, data);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });

    it("should approve an ERC20", async () => {
      const data = token.contract.methods.approve(uniZap.address, web3.utils.toWei("1", "finney")).encodeABI();
      const transaction = encodeTransaction(token.address, 0, data);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      const { success } = await utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, "transfer failed");
    });
  });
});
