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
const ERC20 = artifacts.require("TestERC20");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");

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

  const infrastructure = accounts[0];
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

  let tokenA;
  let lido;
  let lidoAddress;
  let tokenPriceRegistry;

  before(async () => {
    // Deploy test tokens
    //tokenA = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);

    lidoAddress = "0x20dC62D5904633cC6a5E34bEc87A048E80C92e97";
    // Deploy Lido
    //lido = await LidoPool.new([tokenA.address]);
    lido = await ILido.at(lidoAddress);
    
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

    // await initNonce(wallet, module, manager, SECURITY_PERIOD);
  });

  describe("Lido staking", () => {
    it("should allow staking from wallet", async () => {
      const transactions = [];
      let transaction = encodeTransaction(lido.address, 10, ZERO_BYTES);
      transactions.push(transaction);

      //const data = lido.contract.methods.depositBufferedEther().encodeABI();
      //transaction = encodeTransaction(lido.address, 0, data);
      //transactions.push(transaction);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `deposit failed: "${error}"`);
    });

    it("should not allow staking on behalf of non-wallet", async () => {
      // const { success, error } = await deposit(infrastructure);
      // assert.isFalse(success, "deposit should have failed");
      // assert.equal(error, "TM: call not authorised");
    });

    it("should not allow calling forbidden staking pool methods", async () => {
      // const { success, error } = await multiCall(encodeTransaction([
      //   [lido, "borrow", [tokenA.address, amount, 0, 0, wallet.address]]
      // ]));
      // assert.isFalse(success, "borrow should have failed");
      // assert.equal(error, "TM: call not authorised");
    });
  });
});