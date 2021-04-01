/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");
const WETH = artifacts.require("WETH9");

const MultiCallHelper = artifacts.require("MultiCallHelper");

const AaveV2Filter = artifacts.require("AaveV2Filter");
const AaveV2LendingPool = artifacts.require("AaveV2LendingPoolMock");
const ERC20 = artifacts.require("TestERC20");

const { encodeTransaction, addTrustedContact, createWallet } = require("../utils/utilities.js");

const ZERO_BYTES = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const MAX_UINT = (new BN(2)).pow(new BN(256)).sub(new BN(1));

contract("MultiCallHelper", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const trustedContact = accounts[4];
  const authorisedDapp = accounts[5];
  const unknownAddress = accounts[6];
  const refundAddress = accounts[7];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let factory;
  let dappRegistry;
  let filter;
  let helper;
  let tokenA;
  let aave;

  before(async () => {
    // Deploy test tokens
    tokenA = await ERC20.new([infrastructure], web3.utils.toWei("1000"), 18);

    // Deploy AaveV2
    aave = await AaveV2LendingPool.new([tokenA.address]);

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const weth = await WETH.new();
    const uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);

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
    filter = await AaveV2Filter.new();
    await dappRegistry.addDapp(0, aave.address, filter.address);

    await dappRegistry.addDapp(0, authorisedDapp, ZERO_ADDRESS);

    const walletImplementation = await BaseWallet.new();
    factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);

    helper = await MultiCallHelper.new(transferStorage.address, dappRegistry.address);
  });

  beforeEach(async () => {
    // create wallet
    const walletAddress = await createWallet(factory.address, owner, [module.address], guardian1);
    wallet = await BaseWallet.at(walletAddress);
    await wallet.send(new BN("1000000000000000000"));

    await addTrustedContact(wallet, trustedContact, module, SECURITY_PERIOD);
  });

  describe("multicall helper", () => {
    it("should return true when the multicall is authorised", async () => {
      const transactions = [];
      transactions.push(encodeTransaction(trustedContact, 10, ZERO_BYTES));
      transactions.push(encodeTransaction(authorisedDapp, 10, ZERO_BYTES));

      const authorised = await helper.isMultiCallAuthorised(wallet.address, transactions);
      assert.isTrue(authorised);
    });

    it("should return true when the multicall is authorised for 0 address wallet", async () => {
      const transactions = [];
      transactions.push(encodeTransaction(authorisedDapp, 10, ZERO_BYTES));

      const authorised = await helper.isMultiCallAuthorised(ZERO_ADDRESS, transactions);
      assert.isTrue(authorised);
    });

    it("should return false when the multicall is not authorised", async () => {
      const transactions = [];
      transactions.push(encodeTransaction(trustedContact, 10, ZERO_BYTES));
      transactions.push(encodeTransaction(unknownAddress, 10, ZERO_BYTES));

      const authorised = await helper.isMultiCallAuthorised(wallet.address, transactions);
      assert.isFalse(authorised);
    });

    it("should return the correct registry ID", async () => {
      const transactions = [];
      transactions.push(encodeTransaction(trustedContact, 10, ZERO_BYTES));
      transactions.push(encodeTransaction(authorisedDapp, 10, ZERO_BYTES));
      transactions.push(encodeTransaction(unknownAddress, 10, ZERO_BYTES));

      const registryId = await helper.multiCallAuthorisation(wallet.address, transactions);
      assert.equal(registryId[0], 256, "should be 256 for trusted contacts");
      assert.equal(registryId[1], 0, "should be the correct registry");
      assert.isTrue(MAX_UINT.eq(registryId[2]), "should be MAX_UINT when not trusted");
    });

    it("should return true when the multicall is authorised for a registry", async () => {
      await tokenA.mint(wallet.address, web3.utils.toWei("1000"));
      const transactions = [];
      transactions.push(encodeTransaction(tokenA.address, 0, tokenA.contract.methods.approve(aave.address, 100).encodeABI()));
      transactions.push(encodeTransaction(aave.address, 0, aave.contract.methods.deposit(tokenA.address, 100, wallet.address, "").encodeABI()));

      const authorised = await helper.isAuthorisedInRegistry(wallet.address, transactions, 0);
      assert.isTrue(authorised);
    });

    it("should return false when the multicall is not authorised for a registry", async () => {
      await tokenA.mint(wallet.address, web3.utils.toWei("1000"));
      const transactions = [];
      transactions.push(encodeTransaction(tokenA.address, 0, tokenA.contract.methods.approve(aave.address, 100).encodeABI()));
      transactions.push(encodeTransaction(aave.address, 0, aave.contract.methods.deposit(tokenA.address, 100, wallet.address, "").encodeABI()));
      transactions.push(encodeTransaction(tokenA.address, 0, tokenA.contract.methods.approve(unknownAddress, 100).encodeABI()));

      const authorised = await helper.isAuthorisedInRegistry(wallet.address, transactions, 0);
      assert.isFalse(authorised);
    });
  });
});
