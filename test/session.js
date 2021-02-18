/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert, expect } = chai;
chai.use(bnChai(BN));

const truffleAssert = require("truffle-assertions");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const LockStorage = artifacts.require("LockStorage");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const Authoriser = artifacts.require("DappRegistry");
const ERC20 = artifacts.require("TestERC20");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, ARGENT_WHITELIST } = require("../utils/utilities.js");

const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("ArgentModule sessions", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const recipient = accounts[4];
  const sessionUser = accounts[6];
  const sessionUser2 = accounts[7];
  const relayer = accounts[9];

  let registry;
  let lockStorage;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let authoriser;
  let token;

  before(async () => {
    registry = await Registry.new();

    lockStorage = await LockStorage.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();

    authoriser = await Authoriser.new();

    module = await ArgentModule.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      transferStorage.address,
      authoriser.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      LOCK_PERIOD,
      RECOVERY_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, relayer, ZERO_ADDRESS);

    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);

    token = await ERC20.new([infrastructure], web3.utils.toWei("10000"), 19);
  });

  async function addGuardians(guardians) {
    // guardians can be BaseWallet or ContractWrapper objects
    for (const guardian of guardians) {
      await module.addGuardian(wallet.address, guardian, { from: owner });
    }

    await utils.increaseTime(30);
    for (let i = 1; i < guardians.length; i += 1) {
      await module.confirmGuardianAddition(wallet.address, guardians[i]);
    }
    const count = (await module.guardianCount(wallet.address)).toNumber();
    assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
  }

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    await wallet.send(new BN("1000000000000000000"));

    await addGuardians([guardian1]);
  });

  async function encodeTransaction(to, value, data, isSpenderInData = false) {
    return { to, value, data, isSpenderInData };
  }

  describe("session lifecycle", () => {
    it("owner plus majority guardians should be able to start a session", async () => {
      const data = module.contract.methods.startSession(wallet.address, sessionUser, 1000).encodeABI();
      const transaction = await encodeTransaction(module.address, 0, data, false);

      const txReceipt = await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient);

      const { success } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success);

      const session = await module.getSession(wallet.address);
      assert.equal(session.key, sessionUser);

      const timestamp = await utils.getTimestamp(txReceipt.blockNumber);
      expect(session.expires).to.eq.BN(timestamp + 1000);
    });

    it("should be able to overwrite an existing session", async () => {
      // Start a session for sessionUser with duration 1000s
      let data = module.contract.methods.startSession(wallet.address, sessionUser, 1000).encodeABI();
      let transaction = await encodeTransaction(module.address, 0, data, false);
      await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient);

      // Start another session on the same wallet for sessionUser2 with duration 2000s
      data = module.contract.methods.startSession(wallet.address, sessionUser2, 2000).encodeABI();
      transaction = await encodeTransaction(module.address, 0, data, false);
      const txReceipt = await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient);

      const { success } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success);

      const session = await module.getSession(wallet.address);
      assert.equal(session.key, sessionUser2);

      const timestamp = await utils.getTimestamp(txReceipt.blockNumber);
      expect(session.expires).to.eq.BN(timestamp + 2000);
    });

    it.skip("should not be able to start a session for empty user address", async () => {
      const data = module.contract.methods.startSession(wallet.address, ZERO_ADDRESS, 1000).encodeABI();
      const transaction = await encodeTransaction(module.address, 0, data, false);
      await truffleAssert.reverts(manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient), "RM: Invalid session user");
    });

    it.skip("should not be able to start a session for zero duration", async () => {
      const data = module.contract.methods.startSession(wallet.address, sessionUser, 0).encodeABI();
      const transaction = await encodeTransaction(module.address, 0, data, false);
      await truffleAssert.reverts(manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient), "RM: Invalid session duration");
    });

    it("owner should be able to clear a session", async () => {
      // Start a session for sessionUser with duration 1000s
      const data = module.contract.methods.startSession(wallet.address, sessionUser, 1000).encodeABI();
      const transaction = await encodeTransaction(module.address, 0, data, false);
      await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);

      // owner clears the session
      const txReceipt = await manager.relay(
        module,
        "clearSession",
        [wallet.address],
        wallet,
        [owner],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);

      const { success } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success);

      const session = await module.getSession(wallet.address);
      assert.equal(session.key, ZERO_ADDRESS);

      expect(session.expires).to.eq.BN(0);
    });

    it("non-owner should not be able to clear a session", async () => {
      // Start a session for sessionUser with duration 1000s
      const data = module.contract.methods.startSession(wallet.address, sessionUser, 1000).encodeABI();
      const transaction = await encodeTransaction(module.address, 0, data, false);
      await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);

      // owner clears the session
      await truffleAssert.reverts(manager.relay(
        module,
        "clearSession",
        [wallet.address],
        wallet,
        [accounts[8]],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS), "RM: Invalid signatures");
    });
  });

  describe("approved transfer (without using a session)", () => {
    it("should be able to send ETH with guardians", async () => {
      const transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);

      const balanceBefore = await utils.getBalance(recipient);
      const txReceipt = await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success);

      const balanceAfter = await utils.getBalance(recipient);
      expect(balanceAfter.sub(balanceBefore)).to.eq.BN(10);
    });

    it("should be able to transfer ERC20 with guardians", async () => {
      await token.transfer(wallet.address, 10);
      const data = await token.contract.methods.transfer(recipient, 10).encodeABI();
      const transaction = await encodeTransaction(token.address, 0, data);

      const balanceBefore = await token.balanceOf(recipient);
      const txReceipt = await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success);

      const balanceAfter = await token.balanceOf(recipient);
      expect(balanceAfter.sub(balanceBefore)).to.eq.BN(10);
    });
  });

  describe("transfer using session", () => {
    beforeEach(async () => {
      // Create a session for sessionUser with duration 1000s to use in tests
      const data = module.contract.methods.startSession(wallet.address, sessionUser, 10000).encodeABI();
      const transaction = await encodeTransaction(module.address, 0, data, false);

      await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, false, [transaction]],
        wallet,
        [owner, guardian1],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);
    });

    it("should be able to send ETH", async () => {
      const transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);

      const balanceBefore = await utils.getBalance(recipient);
      const txReceipt = await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, true, [transaction]],
        wallet,
        [sessionUser],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success);

      const balanceAfter = await utils.getBalance(recipient);
      expect(balanceAfter.sub(balanceBefore)).to.eq.BN(10);
    });

    it("should be able to transfer ERC20", async () => {
      await token.transfer(wallet.address, 10);
      const data = await token.contract.methods.transfer(recipient, 10).encodeABI();
      const transaction = await encodeTransaction(token.address, 0, data);

      const balanceBefore = await token.balanceOf(recipient);
      const txReceipt = await manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, true, [transaction]],
        wallet,
        [sessionUser],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success);

      const balanceAfter = await token.balanceOf(recipient);
      expect(balanceAfter.sub(balanceBefore)).to.eq.BN(10);
    });

    it("should not be able to send ETH with invalid session", async () => {
      const transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);

      await truffleAssert.reverts(manager.relay(
        module,
        "multiCallWithApproval",
        [wallet.address, true, [transaction]],
        wallet,
        [sessionUser2],
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS), "RM: Invalid session");
    });
  });
});
