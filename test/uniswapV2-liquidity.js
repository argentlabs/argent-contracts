/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");
const WETH = artifacts.require("WETH9");
const UniZap = artifacts.require("UniZap");

// Argent
const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TokenRegistry = artifacts.require("TokenRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const ERC20 = artifacts.require("TestERC20");
const UniZapFilter = artifacts.require("UniswapV2UniZapFilter");

// Utils
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, assertFailedWithError } = require("../utils/utilities.js");
const { makeUniswapMethods } = require("../utils/uniswap.js");

const ZERO_BYTES = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("Uniswap V2", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const recipient = accounts[4];
  const refundAddress = accounts[7];
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let factory;
  let filter;
  let dappRegistry;
  let tokenRegistry;
  let uniswapRouter;
  let token;
  let weth;
  let lpToken;
  let uniZap;

  let addLiquidity;
  let removeLiquidity;

  before(async () => {
    // Deploy and mint test tokens
    token = await ERC20.new([infrastructure], web3.utils.toWei("100"), 18);
    weth = await WETH.new();
    await weth.send(web3.utils.toWei("1"));

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);
    // create token pool
    await token.approve(uniswapRouter.address, web3.utils.toWei("3"));
    await weth.approve(uniswapRouter.address, web3.utils.toWei("1"));
    const timestamp = await utils.getTimestamp();
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

    const walletImplementation = await BaseWallet.new();
    factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);

    // make LP token tradable
    tokenRegistry = await TokenRegistry.new();
    await tokenRegistry.setTradableForTokenList([lpToken.address], [true]);
    // deploy unizap filter
    const uniInitCode = await uniswapFactory.getKeccakOfPairCreationCode();
    filter = await UniZapFilter.new(tokenRegistry.address, uniswapFactory.address, uniInitCode, weth.address);

    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, uniZap.address, filter.address);
  });

  beforeEach(async () => {
    // create wallet
    const walletAddress = await utils.createWallet(factory.address, owner, [module.address], guardian1);
    wallet = await BaseWallet.at(walletAddress);

    // fund wallet
    await wallet.send(web3.utils.toWei("1"));
    await token.mint(wallet.address, web3.utils.toWei("10"));

    ({ addLiquidity, removeLiquidity } = makeUniswapMethods({ manager, module, owner, WETH: weth }, wallet, uniZap, token, lpToken));
  });

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

    it("should block adding liquidity when the pair is not valid", async () => {
      await tokenRegistry.setTradableForTokenList([lpToken.address], [false]);
      const txReceipt = await addLiquidity(token, web3.utils.toWei("1", "finney"), wallet.address);
      await tokenRegistry.setTradableForTokenList([lpToken.address], [true]);
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

    it("should block removing liquidity when the pair is not valid", async () => {
      await tokenRegistry.setTradableForTokenList([lpToken.address], [false]);
      await addLiquidity(ETH_TOKEN, web3.utils.toWei("1", "finney"), wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      const txReceipt = await removeLiquidity(token.address, lpBalance.div(new BN(2)).toString(), wallet.address);
      await tokenRegistry.setTradableForTokenList([lpToken.address], [true]);
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
