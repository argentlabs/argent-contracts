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
const truffleAssert = require("truffle-assertions");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");

const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const CUSTOM_REGISTRY_ID = 12;

const RelayManager = require("../utils/relay-manager");

contract("Authorisation", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const nonwhitelisted = accounts[2];
  const recipient = accounts[3];
  const nonceInitialiser = accounts[4];
  const registryOwner = accounts[5];
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let erc20;
  let filter;
  let filter2;
  let authoriser;
  let contract;
  let contract2;
  let uniswapRouter;

  before(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    uniswapRouter = await UniswapV2Router01.new();

    contract = await TestContract.new();
    contract2 = await TestContract.new();
    assert.equal(await contract.state(), 0, "initial contract state should be 0");
    assert.equal(await contract2.state(), 0, "initial contract2 state should be 0");
    filter = await Filter.new();
    filter2 = await Filter.new();

    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  async function setupRegistries() {
    authoriser = await Authoriser.new(SECURITY_PERIOD);
    await authoriser.createRegistry(CUSTOM_REGISTRY_ID, registryOwner);
    await authoriser.addFilter(0, contract.address, filter.address);
    await authoriser.addFilter(CUSTOM_REGISTRY_ID, contract2.address, filter.address, { from: registryOwner });
    await authoriser.addFilter(0, recipient, ZERO_ADDRESS);
    await authoriser.addFilter(0, relayer, ZERO_ADDRESS);
    await utils.increaseTime(SECURITY_PERIOD + 1);
    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      authoriser.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
  }

  beforeEach(async () => {
    await setupRegistries();
  });

  async function enableCustomRegistry() {
    assert.equal(await authoriser.isEnabledRegistry(wallet.address, CUSTOM_REGISTRY_ID), false, "custom registry should not be enabled");
    const txReceipt = await manager.relay(
      module,
      "toggleDappRegistry",
      [wallet.address, CUSTOM_REGISTRY_ID, true],
      wallet,
      [owner],
      1,
      ETH_TOKEN,
      relayer);
    const success = await utils.parseRelayReceipt(txReceipt).success;
    assert.isTrue(success, "toggleDappRegistry failed");
    assert.equal(await authoriser.isEnabledRegistry(wallet.address, CUSTOM_REGISTRY_ID), true, "custom registry should be enabled");
    console.log("Gas to call toggleDappRegistry: ", txReceipt.gasUsed);
  }

  async function setupWallet() {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    const decimals = 12; // number of decimal for TOKN contract

    erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await wallet.send(new BN("1000000000000000000"));

    await enableCustomRegistry();
  }

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

  // wallet-centric functions

  describe("call (un)authorised contract", () => {
    beforeEach(async () => {
      await setupWallet();
      initNonce();
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
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "call failed");
      console.log("Gas to send ETH: ", txReceipt.gasUsed);
    });

    it("should call authorised contract when filter passes (argent registry)", async () => {
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

    it("should call authorised contract when filter passes (community registry)", async () => {
      const data = contract2.contract.methods.setState(4).encodeABI();
      const transaction = await encodeTransaction(contract2.address, 0, data, false);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        relayer);
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
        relayer);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "call should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not send ETH to unauthorised address", async () => {
      const transaction = await encodeTransaction(nonwhitelisted, 100, ZERO_BYTES32, false);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        10,
        ETH_TOKEN,
        relayer);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transfer should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  describe("approve token and call authorised contract", () => {
    beforeEach(async () => {
      await setupWallet();
      await initNonce();
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
        relayer);
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
        relayer);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "call should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  describe("enable/disable registry for wallet", () => {
    beforeEach(async () => {
      await setupWallet();
    });
    it("should not enable non-existing registry", async () => {
      const txReceipt = await manager.relay(
        module,
        "toggleDappRegistry",
        [wallet.address, 66, true],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "toggleDappRegistry should have failed");
      assert.equal(error, "AR: unknown registry");
    });
    it("should not enable already-enabled registry", async () => {
      const txReceipt = await manager.relay(
        module,
        "toggleDappRegistry",
        [wallet.address, CUSTOM_REGISTRY_ID, true],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "toggleDappRegistry should have failed");
      assert.equal(error, "AR: bad state change");
    });
  });

  // management of registry contract

  describe("add registry", () => {
    it("should not create a duplicate registry", async () => {
      await truffleAssert.reverts(
        authoriser.createRegistry(CUSTOM_REGISTRY_ID, registryOwner, { from: infrastructure }), "AR: duplicate registry"
      );
    });
    it("should not create a registry without owner", async () => {
      await truffleAssert.reverts(
        authoriser.createRegistry(CUSTOM_REGISTRY_ID, ZERO_ADDRESS, { from: infrastructure }), "AR: registry owner is 0"
      );
    });
  });

  describe("owner change", () => {
    it("changes a registry owner", async () => {
      await authoriser.changeOwner(0, recipient);
      let regOwner = await authoriser.registryOwners(0, { from: infrastructure });
      assert.equal(regOwner, recipient, "registry owner change failed");
      await authoriser.changeOwner(0, infrastructure, { from: recipient });
      regOwner = await authoriser.registryOwners(0);
      assert.equal(regOwner, infrastructure, "registry owner change failed");
    });

    it("can't change a registry to null owner", async () => {
      await truffleAssert.reverts(
        authoriser.changeOwner(0, ZERO_ADDRESS, { from: infrastructure }), "AR: new registry owner is 0"
      );
    });
  });

  describe("timelock change", () => {
    it("can change the timelock", async () => {
      const tl = await authoriser.securityPeriod();
      const requestedTl = 12;
      await authoriser.requestTimelockChange(requestedTl, { from: infrastructure });
      await truffleAssert.reverts(
        authoriser.confirmTimelockChange(), "AR: can't (yet) change timelock"
      );
      let newTl = await authoriser.securityPeriod();
      assert.equal(newTl.toString(), tl.toString(), "timelock shouldn't have changed");
      await utils.increaseTime(requestedTl);
      await authoriser.confirmTimelockChange();
      newTl = await authoriser.securityPeriod();
      assert.equal(newTl.toString(), requestedTl, "timelock change failed");

      await authoriser.requestTimelockChange(tl, { from: infrastructure });
      await utils.increaseTime(newTl);
    });
  });

  // management of registry content

  describe("add/remove filter", () => {
    it("should allow addFilter to override non-existing filter", async () => {
      await authoriser.addFilter(0, contract2.address, ZERO_ADDRESS, { from: infrastructure });
      await authoriser.addFilter(0, contract2.address, filter.address, { from: infrastructure });
    });
    it("should not allow addFilter to override existing filter", async () => {
      await authoriser.addFilter(0, contract2.address, filter.address, { from: infrastructure });
      await truffleAssert.reverts(
        authoriser.addFilter(0, contract2.address, filter.address, { from: infrastructure }), "DR: filter already set"
      );
    });
    it("should not allow non-owner to add authorisation to the Argent registry", async () => {
      await truffleAssert.reverts(
        authoriser.addFilter(0, contract2.address, filter.address, { from: nonwhitelisted }), "AR: sender != registry owner"
      );
    });
    it("should allow removing a dapp", async () => {
      await truffleAssert.reverts(
        authoriser.removeDapp(0, contract2.address, { from: infrastructure }), "AR: unknown dapp"
      );
      await authoriser.addFilter(0, contract2.address, ZERO_ADDRESS, { from: infrastructure });
      await authoriser.removeDapp(0, contract2.address, { from: infrastructure });
    });
  });

  describe("update filter", () => {
    it("should allow changing an existing filter", async () => {
      await authoriser.addFilter(0, contract2.address, filter.address, { from: infrastructure });
      await authoriser.requestFilterUpdate(0, contract2.address, filter2.address, { from: infrastructure });
      await truffleAssert.reverts(
        authoriser.confirmFilterUpdate(0, contract2.address, { from: infrastructure }),
        "AR: too early to confirm auth"
      );
      const tl = await authoriser.securityPeriod();
      await utils.increaseTime(tl);
      await authoriser.confirmFilterUpdate(0, contract2.address, { from: infrastructure });
    });
    it("should not allow changing a non-existing filter", async () => {
      await authoriser.addFilter(0, contract2.address, ZERO_ADDRESS, { from: infrastructure });
      await truffleAssert.reverts(
        authoriser.requestFilterUpdate(0, contract2.address, filter.address, { from: infrastructure }),
        "AR: should use addFilter()"
      );
    });
    it("should not allow confirming change of a non-existing pending change", async () => {
      await truffleAssert.reverts(
        authoriser.confirmFilterUpdate(0, contract2.address, { from: infrastructure }),
        "AR: no pending filter update"
      );
    });
  });
});
