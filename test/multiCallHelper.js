/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");
const MultiCallHelper = artifacts.require("MultiCallHelper");

const { encodeTransaction, addTrustedContact } = require("../utils/utilities.js");

const ZERO_BYTES = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const MAX_UINT = (new BN(2)).pow(new BN(256)).sub(new BN(1));

contract("ArgentModule", (accounts) => {
  const owner = accounts[1];
  const trustedContact = accounts[4];
  const authorisedDapp = accounts[5];
  const unknownAddress = accounts[6];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let dappRegistry;
  let helper;

  before(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    dappRegistry = await DappRegistry.new(0);
    helper = await MultiCallHelper.new(transferStorage.address, dappRegistry.address);

    const uniswapRouter = await UniswapV2Router01.new();

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

    await dappRegistry.addDapp(0, authorisedDapp, ZERO_ADDRESS);

    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);
    await wallet.send(new BN("1000000000000000000"));

    await addTrustedContact(wallet, trustedContact, module, SECURITY_PERIOD);
  });

  describe("multicall", () => {
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
  });
});
