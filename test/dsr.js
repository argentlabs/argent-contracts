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

// Argent
const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const PotFilter = artifacts.require("PotFilter");
const VatFilter = artifacts.require("VatFilter");
const DaiJoinFilter = artifacts.require("DaiJoinFilter");

// Utils
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, initNonce, encodeCalls, encodeTransaction } = require("../utils/utilities.js");
const { deployMaker, WAD } = require("../utils/defi-deployer");

const DAI_SENT = WAD.div(new BN(100000000));
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("DSR Filter", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const relayer = accounts[4];
  const refundAddress = accounts[7];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let factory;
  let dappRegistry;
  let uniswapRouter;
  let pot;
  let dai;
  let daiJoin;
  let vat;

  before(async () => {
    // Deploy Maker
    const m = await deployMaker(infrastructure);
    [pot, dai, vat, daiJoin] = [m.pot, m.dai, m.vat, m.daiJoin];

    // Deploy and fund UniswapV2
    const weth = await WETH.new();
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
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

    await dappRegistry.addDapp(0, pot.address, (await PotFilter.new()).address);
    await dappRegistry.addDapp(0, daiJoin.address, (await DaiJoinFilter.new()).address);
    await dappRegistry.addDapp(0, vat.address, (await VatFilter.new(daiJoin.address, pot.address)).address);
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
    await wallet.send(web3.utils.toWei("0.1"));
    await dai.mint(wallet.address, DAI_SENT.muln(20));

    await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  const multiCall = async (transactions) => {
    const txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, transactions],
      wallet,
      [owner],
      1,
      ETH_TOKEN,
      relayer);
    return utils.parseRelayReceipt(txReceipt);
  };

  const deposit = async () => multiCall(encodeCalls([
    [pot, "drip"],
    [dai, "approve", [daiJoin.address, DAI_SENT.toString()]],
    [daiJoin, "join", [wallet.address, DAI_SENT.toString()]],
    [vat, "hope", [pot.address]],
    [pot, "join", [DAI_SENT.toString()]],
  ]));

  const withdraw = async () => multiCall(encodeCalls([
    [pot, "drip"],
    [pot, "exit", [DAI_SENT.toString()]],
    [vat, "hope", [daiJoin.address]],
    [daiJoin, "exit", [wallet.address, DAI_SENT.toString()]],
  ]));

  it("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow withdrawals", async () => {
    await deposit();
    const { success, error } = await withdraw({ all: false });
    assert.isTrue(success, `withdraw failed: "${error}"`);
  });

  it("should not allow direct transfers to pot, vat or daiJoin", async () => {
    for (const to of [pot.address, vat.address, daiJoin.address]) {
      const { success, error } = await multiCall(encodeCalls([[dai, "transfer", [to, DAI_SENT.toString()]]]));
      assert.isFalse(success, "transfer should have failed");
      assert.equal(error, "TM: call not authorised");
    }
  });

  it("should not allow unsupported method call to pot, vat or daiJoin", async () => {
    for (const [to, method] of [[pot, "cage"], [vat, "vice"], [daiJoin, "live"]]) {
      const { success, error } = await multiCall(encodeCalls([[to, method]]));
      assert.isFalse(success, `${method}() should have failed`);
      assert.equal(error, "TM: call not authorised");
    }
  });

  it("should not allow sending ETH to pot, vat or daiJoin", async () => {
    for (const to of [pot.address, vat.address, daiJoin.address]) {
      const { success, error } = await multiCall([encodeTransaction(to, web3.utils.toWei("0.01"), "0x")]);
      assert.isFalse(success, "sending ETH should have failed");
      assert.equal(error, "TM: call not authorised");
    }
  });
});
