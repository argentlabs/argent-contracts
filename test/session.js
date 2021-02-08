/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const TruffleContract = require("@truffle/contract");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const LockStorage = artifacts.require("LockStorage");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const Authoriser = artifacts.require("DappRegistry");

const ERC20 = artifacts.require("TestERC20");
const TestContract = artifacts.require("TestContract");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, ARGENT_WHITELIST } = require("../utils/utilities.js");
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");
const { assert } = require("chai");

contract("ArgentModule", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const recipient = accounts[4];
  const nonceInitialiser = accounts[5];
  const sessionKey = accounts[6];
  const relayer = accounts[9];

  let registry;
  let lockStorage;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let erc20;

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
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    const decimals = 12; // number of decimal for TOKN contract
    erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await wallet.send(new BN("1000000000000000000"));
  });

  async function encodeTransaction(to, value, data, isSpenderInData = false) {
    return { to, value, data, isSpenderInData };
  }

  async function whitelist(target) {
    await module.addToWhitelist(wallet.address, target, { from: owner });
    await utils.increaseTime(3);
    isTrusted = await module.isWhitelisted(wallet.address, target);
    assert.isTrue(isTrusted, "should be trusted after the security period");
  }

  async function initNonce() {
    // add to whitelist
    await whitelist(nonceInitialiser);
    // set the relayer nonce to > 0
    let transaction = await encodeTransaction(nonceInitialiser, 1, ZERO_BYTES32, false);
    let txReceipt = await manager.relay(
      module,
      "multiCall",
      [wallet.address, [transaction]],
      wallet,
      [owner]);
    success = await utils.parseRelayReceipt(txReceipt).success;
    assert.isTrue(success, "transfer failed");
    const nonce = await module.getNonce(wallet.address);
    assert.isTrue(nonce.gt(0), "nonce init failed");
  }

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

  describe("transfer ETH with session", () => {
    beforeEach(async () => {
      await initNonce();
      await addGuardians([guardian1]);
    });

    it("should send ETH with guardians", async () => {
      let transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);
      let session = { key: sessionKey, expires: 0 };

      let txReceipt = await manager.relay(
        module,
        "multiCallWithSession",
        [wallet.address, session, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient);
      success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      console.log("Gas for ETH transfer with 1 guardian: " + txReceipt.gasUsed);
    });

    it("should send ETH and create session", async () => {
      let transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);
      let session = { key: sessionKey, expires: 1000000 };

      let txReceipt = await manager.relay(
        module,
        "multiCallWithSession",
        [wallet.address, session, [transaction]],
        wallet,
        [owner, guardian1],
        1,
        ETH_TOKEN,
        recipient);
      success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      console.log("Gas for ETH transfer and create session: " + txReceipt.gasUsed);
    });

    it("should send ETH with session key", async () => {
      let expires = (await utils.getTimestamp()) + 10000;
      let transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);
      let session = { key: sessionKey, expires };

      let txReceipt = await manager.relay(
        module,
        "multiCallWithSession",
        [wallet.address, session, [transaction]],
        wallet,
        [owner, guardian1]);
      success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");

      txReceipt = await manager.relay(
        module,
        "multiCallWithSession",
        [wallet.address, { key: ZERO_ADDRESS, expires: 0 }, [transaction]],
        wallet,
        [sessionKey],
        1,
        ETH_TOKEN,
        recipient);
      success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      console.log("Gas for ETH transfer with session: " + txReceipt.gasUsed);
    });
  });
});