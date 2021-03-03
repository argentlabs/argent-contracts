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
const DappRegistry = artifacts.require("DappRegistry");
const ERC20 = artifacts.require("TestERC20");
const TestContract = artifacts.require("TestContract");
const Filter = artifacts.require("TestFilter");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const { assert } = require("chai");
const truffleAssert = require("truffle-assertions");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, initNonce } = require("../utils/utilities.js");

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
  let dappRegistry;
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
    dappRegistry = await DappRegistry.new(SECURITY_PERIOD);
    await dappRegistry.createRegistry(CUSTOM_REGISTRY_ID, registryOwner);
    await dappRegistry.addDapp(0, contract.address, filter.address);
    await dappRegistry.addDapp(CUSTOM_REGISTRY_ID, contract2.address, filter.address, { from: registryOwner });
    await dappRegistry.addDapp(0, recipient, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, dappRegistry.address, ZERO_ADDRESS); // authorise "toggleRegistry()"
    await utils.increaseTime(SECURITY_PERIOD + 1);
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
  }

  beforeEach(async () => {
    await setupRegistries();
  });

  async function enableCustomRegistry() {
    assert.equal(await dappRegistry.isEnabledRegistry(wallet.address, CUSTOM_REGISTRY_ID), false, "custom registry should not be enabled");
    const data = dappRegistry.contract.methods.toggleRegistry(CUSTOM_REGISTRY_ID, true).encodeABI();
    const transaction = encodeTransaction(dappRegistry.address, 0, data);
    const txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, [transaction]],
      wallet,
      [owner]);
    const { success, error } = await utils.parseRelayReceipt(txReceipt);
    assert.isTrue(success, `toggleRegistry failed with "${error}"`);
    assert.equal(await dappRegistry.isEnabledRegistry(wallet.address, CUSTOM_REGISTRY_ID), true, "custom registry should be enabled");
    console.log("Gas to call toggleRegistry: ", txReceipt.gasUsed);
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

  // wallet-centric functions

  describe("call (un)authorised contract", () => {
    beforeEach(async () => {
      await setupWallet();
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
    });

    it("should send ETH to authorised address", async () => {
      const transaction = encodeTransaction(recipient, 100, ZERO_BYTES32);
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
      const transaction = encodeTransaction(contract.address, 0, data);

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
      const transaction = encodeTransaction(contract2.address, 0, data);

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
      const transaction = encodeTransaction(contract.address, 0, data);

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
      const transaction = encodeTransaction(nonwhitelisted, 100, ZERO_BYTES32);

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
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
    });

    it("should call authorised contract when filter pass", async () => {
      const transactions = [];

      let data = erc20.contract.methods.approve(contract.address, 100).encodeABI();
      let transaction = encodeTransaction(erc20.address, 0, data);
      transactions.push(transaction);

      data = contract.contract.methods.setStateAndPayToken(4, erc20.address, 100).encodeABI();
      transaction = encodeTransaction(contract.address, 0, data);
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
      let transaction = encodeTransaction(erc20.address, 0, data);
      transactions.push(transaction);

      data = contract.contract.methods.setStateAndPayToken(5, erc20.address, 100).encodeABI();
      transaction = encodeTransaction(contract.address, 0, data);
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

    it("should have Argent Registry enabled by default", async () => {
      assert.equal(await dappRegistry.isEnabledRegistry(wallet.address, 0), true, "Argent Registry isn't enabled");
    });

    // not a test per se, but just a note of something to be aware of
    it("has isEnabledRegistry return true for _registryId > 255 when isEnabledRegistry(_wallet, _registryId % 256) == true", async () => {
      const dataWithBadSig = utils.encodeFunctionCall("isEnabledRegistry(address,uint)", [wallet.address, 256 + CUSTOM_REGISTRY_ID]);
      const correctSig = web3.utils.sha3("isEnabledRegistry(address,uint8)").slice(0, 10);
      const data = `${correctSig}${dataWithBadSig.slice(10)}`;
      const output = await web3.eth.call({
        to: dappRegistry.address,
        data
      });
      assert.equal(output.toString(), "0x0000000000000000000000000000000000000000000000000000000000000001");
    });

    it("should not enable non-existing registry", async () => {
      const data = dappRegistry.contract.methods.toggleRegistry(66, true).encodeABI();
      const transaction = encodeTransaction(dappRegistry.address, 0, data);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner]);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "toggleRegistry should have failed");
      assert.equal(error, "DR: unknown registry");
    });
  });

  // management of registry contract

  describe("add registry", () => {
    it("should not create a duplicate registry", async () => {
      await truffleAssert.reverts(
        dappRegistry.createRegistry(CUSTOM_REGISTRY_ID, registryOwner, { from: infrastructure }), "DR: duplicate registry"
      );
    });
    it("should not create a registry without owner", async () => {
      await truffleAssert.reverts(
        dappRegistry.createRegistry(CUSTOM_REGISTRY_ID, ZERO_ADDRESS, { from: infrastructure }), "DR: registry owner is 0"
      );
    });
  });

  describe("owner change", () => {
    it("changes a registry owner", async () => {
      await dappRegistry.changeOwner(0, recipient);
      let regOwner = await dappRegistry.registryOwners(0, { from: infrastructure });
      assert.equal(regOwner, recipient, "registry owner change failed");
      await dappRegistry.changeOwner(0, infrastructure, { from: recipient });
      regOwner = await dappRegistry.registryOwners(0);
      assert.equal(regOwner, infrastructure, "registry owner change failed");
    });

    it("can't change a registry to null owner", async () => {
      await truffleAssert.reverts(
        dappRegistry.changeOwner(0, ZERO_ADDRESS, { from: infrastructure }), "DR: new registry owner is 0"
      );
    });
  });

  describe("timelock change", () => {
    it("can change the timelock", async () => {
      const tl = (await dappRegistry.timelockPeriod()).toNumber();
      const requestedTl = 12;
      await dappRegistry.requestTimelockChange(requestedTl, { from: infrastructure });
      await truffleAssert.reverts(
        dappRegistry.confirmTimelockChange(), "DR: can't (yet) change timelock"
      );
      let newTl = (await dappRegistry.timelockPeriod()).toNumber();
      assert.equal(newTl, tl, "timelock shouldn't have changed");
      await utils.increaseTime(requestedTl);
      await dappRegistry.confirmTimelockChange();
      newTl = (await dappRegistry.timelockPeriod()).toNumber();
      assert.equal(newTl, requestedTl, "timelock change failed");

      await dappRegistry.requestTimelockChange(tl, { from: infrastructure });
      await utils.increaseTime(newTl);
    });
  });

  // management of registry content

  describe("add/remove dapp", () => {
    it("should allow registry owner to add a dapp", async () => {
      const { validAfter } = await dappRegistry.getAuthorisation(0, contract2.address);
      assert.equal(validAfter.toNumber(), 0);
      await dappRegistry.addDapp(0, contract2.address, ZERO_ADDRESS, { from: infrastructure });
      const { validAfter: validAfter2 } = await dappRegistry.getAuthorisation(0, contract2.address);
      assert.isTrue(validAfter2.gt(0), "Invalid validAfter after addDapp call");
    });
    it("should not allow registry owner to add duplicate dapp", async () => {
      await dappRegistry.addDapp(0, contract2.address, filter.address, { from: infrastructure });
      await truffleAssert.reverts(
        dappRegistry.addDapp(0, contract2.address, filter.address, { from: infrastructure }), "DR: dapp already added"
      );
    });
    it("should not allow non-owner to add authorisation to the Argent registry", async () => {
      await truffleAssert.reverts(
        dappRegistry.addDapp(0, contract2.address, filter.address, { from: nonwhitelisted }), "DR: sender != registry owner"
      );
    });
    it("should not allow adding authorisation to unknown registry", async () => {
      await truffleAssert.reverts(
        dappRegistry.addDapp(66, contract2.address, filter.address, { from: nonwhitelisted }), "DR: unknown registry"
      );
    });
    it("should allow registry owner to remove a dapp", async () => {
      await truffleAssert.reverts(
        dappRegistry.removeDapp(0, contract2.address, { from: infrastructure }), "DR: unknown dapp"
      );
      await dappRegistry.addDapp(0, contract2.address, ZERO_ADDRESS, { from: infrastructure });
      await dappRegistry.removeDapp(0, contract2.address, { from: infrastructure });
      const { validAfter } = await dappRegistry.getAuthorisation(0, contract2.address);
      assert.equal(validAfter.toNumber(), 0);
    });
  });

  describe("update filter", () => {
    it("should allow registry owner to change an existing filter", async () => {
      await dappRegistry.addDapp(0, contract2.address, filter.address, { from: infrastructure });
      const { filter: filter_ } = await dappRegistry.getAuthorisation(0, contract2.address);
      assert.equal(filter_, filter.address);
      await dappRegistry.requestFilterUpdate(0, contract2.address, filter2.address, { from: infrastructure });
      await truffleAssert.reverts(
        dappRegistry.confirmFilterUpdate(0, contract2.address, { from: infrastructure }),
        "DR: too early to confirm auth"
      );
      const tl = (await dappRegistry.timelockPeriod()).toNumber();
      await utils.increaseTime(tl + 1);
      await dappRegistry.confirmFilterUpdate(0, contract2.address, { from: infrastructure });
      const { filter: filter2_ } = await dappRegistry.getAuthorisation(0, contract2.address);
      assert.equal(filter2_, filter2.address);
    });
    it("should not allow changing filter for a non-existing dapp", async () => {
      await truffleAssert.reverts(
        dappRegistry.requestFilterUpdate(0, contract2.address, filter.address, { from: infrastructure }),
        "DR: unknown dapp"
      );
    });
    it("should not allow confirming change of a non-existing pending change", async () => {
      await truffleAssert.reverts(
        dappRegistry.confirmFilterUpdate(0, contract2.address, { from: infrastructure }),
        "DR: no pending filter update"
      );
    });
  });
});
