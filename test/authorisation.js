/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

chai.use(bnChai(BN));

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const Authoriser = artifacts.require("DappRegistry");
const ERC20 = artifacts.require("TestERC20");
const TestContract = artifacts.require("TestContract");
const Filter = artifacts.require("TestFilter");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const { assert } = require("chai");
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, ARGENT_WHITELIST } = require("../utils/utilities.js");

const ZERO_BYTES32 = ethers.constants.HashZero;
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
  const nonceInitialiser = accounts[4];
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let erc20;
  let filter;
  let authoriser;
  let contract;

  before(async () => {
    registry = await Registry.new();

    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();

    authoriser = await Authoriser.new();

    const uniswapRouter = await UniswapV2Router01.new();

    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      authoriser.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      LOCK_PERIOD,
      RECOVERY_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, relayer, ZERO_ADDRESS);

    filter = await Filter.new();

    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    const decimals = 12; // number of decimal for TOKN contract

    erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await wallet.send(new BN("1000000000000000000"));

    contract = await TestContract.new();
    assert.equal(await contract.state(), 0, "initial contract state should be 0");
  });

  async function encodeTransaction(to, value, data, isSpenderInData) {
    return { to, value, data, isSpenderInData };
  }

  async function whitelist(target) {
    await module.addToWhitelist(wallet.address, target, { from: owner });
    await utils.increaseTime(3);
    const isTrusted = await module.isWhitelisted(wallet.address, target);
    assert.isTrue(isTrusted, "should be trusted after the security period");
  }

  async function initNonce() {
    // add to whitelist
    await whitelist(nonceInitialiser);
    // set the relayer nonce to > 0
    const transaction = await encodeTransaction(nonceInitialiser, 1, ZERO_BYTES32, false);
    const txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, [transaction]],
      wallet,
      [owner]);
    const success = await utils.parseRelayReceipt(txReceipt).success;
    assert.isTrue(success, "transfer failed");
  }

  describe("call authorised contract", () => {
    beforeEach(async () => {
      initNonce();
      await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, contract.address, filter.address);
      await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, recipient, ZERO_ADDRESS);
    });

    it("should send ETH to authorised address", async () => {
      const transaction = await encodeTransaction(recipient, 100, ZERO_BYTES32, false);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        recipient);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "call failed");
      console.log("Gas to send ETH: ", txReceipt.gasUsed);
    });

    it("should call authorised contract when filter pass", async () => {
      const data = contract.contract.methods.setState(4).encodeABI();
      const transaction = await encodeTransaction(contract.address, 0, data, false);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        recipient);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "call failed");
      assert.equal(await contract.state(), 4, "contract state should be 4");
      console.log("Gas to call contract: ", txReceipt.gasUsed);
    });

    it("should block call to authorised contract when filter doesn't pass", async () => {
      const data = contract.contract.methods.setState(5).encodeABI();
      const transaction = await encodeTransaction(contract.address, 0, data, false);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        recipient);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "call should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  describe("approve token and call authorised contract", () => {
    beforeEach(async () => {
      await initNonce();
      await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, contract.address, filter.address);
      await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, recipient, ZERO_ADDRESS);
    });

    it("should call authorised contract when filter pass", async () => {
      const transactions = [];

      let data = erc20.contract.methods.approve(contract.address, 100).encodeABI();
      let transaction = await encodeTransaction(erc20.address, 0, data, true);
      transactions.push(transaction);

      data = contract.contract.methods.setStateAndPayToken(4, erc20.address, 100).encodeABI();
      transaction = await encodeTransaction(contract.address, 0, data, false);
      transactions.push(transaction);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        recipient);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "call failed");
      assert.equal(await contract.state(), 4, "contract state should be 4");
      console.log("Gas to approve token and call contract: ", txReceipt.gasUsed);
    });

    it("should block call to authorised contract when filter doesn't pass", async () => {
      const transactions = [];

      let data = erc20.contract.methods.approve(contract.address, 100).encodeABI();
      let transaction = await encodeTransaction(erc20.address, 0, data, true);
      transactions.push(transaction);

      data = contract.contract.methods.setStateAndPayToken(5, erc20.address, 100).encodeABI();
      transaction = await encodeTransaction(contract.address, 0, data, false);
      transactions.push(transaction);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        recipient);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "call should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });
});
