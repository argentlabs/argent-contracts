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
const ERC721 = artifacts.require("TestERC721");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const ERC20 = artifacts.require("TestERC20");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, addTrustedContact, initNonce } = require("../utils/utilities.js");

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
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let erc20;
  let dappRegistry;

  before(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    dappRegistry = await DappRegistry.new(0);

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
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);

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

  describe("whitelist", () => {
    beforeEach(async () => {
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
    });
    it("should whitelist an address", async () => {
      const target = accounts[6];
      const txReceipt = await manager.relay(
        module,
        "addToWhitelist",
        [wallet.address, target],
        wallet,
        [owner]);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      await utils.increaseTime(3);
      const isTrusted = await module.isWhitelisted(wallet.address, target);
      assert.isTrue(isTrusted, "should be trusted after the security period");
      console.log(`Gas for whitelisting: ${txReceipt.gasUsed}`);
    });

    it("should not add wallet to whitelist", async () => {
      const txReceipt = await manager.relay(
        module,
        "addToWhitelist",
        [wallet.address, wallet.address],
        wallet,
        [owner]);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "TM: Cannot whitelist wallet");
    });

    it("should not add module to whitelist", async () => {
      const txReceipt = await manager.relay(
        module,
        "addToWhitelist",
        [wallet.address, module.address],
        wallet,
        [owner]);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "TM: Cannot whitelist module");
    });
  });

  describe("transfer ETH", () => {
    beforeEach(async () => {
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
    });

    it("should send ETH to a whitelisted address", async () => {
      await addTrustedContact(wallet, recipient, module, SECURITY_PERIOD);
      const balanceStart = await utils.getBalance(recipient);

      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      const balanceEnd = await utils.getBalance(recipient);
      assert.equal(balanceEnd.sub(balanceStart), 10, "should have received ETH");

      console.log(`Gas for ETH transfer: ${txReceipt.gasUsed}`);
    });
  });

  describe("transfer/Approve ERC20", () => {
    beforeEach(async () => {
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
      // init erc20 - recipient storage slot
      await erc20.transfer(recipient, new BN("100"));
    });

    it("should send ERC20 to a whitelisted address", async () => {
      await addTrustedContact(wallet, recipient, module, SECURITY_PERIOD);
      const balanceStart = await erc20.balanceOf(recipient);

      const data = erc20.contract.methods.transfer(recipient, 100).encodeABI();
      const transaction = encodeTransaction(erc20.address, 0, data);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      const balanceEnd = await erc20.balanceOf(recipient);
      assert.equal(balanceEnd.sub(balanceStart), 100, "should have received tokens");
      console.log(`Gas for EC20 transfer: ${txReceipt.gasUsed}`);
    });

    it("should approve ERC20 for a whitelisted address", async () => {
      await addTrustedContact(wallet, recipient, module, SECURITY_PERIOD);

      const data = erc20.contract.methods.approve(recipient, 100).encodeABI();
      const transaction = encodeTransaction(erc20.address, 0, data);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      const balance = await erc20.allowance(wallet.address, recipient);
      assert.equal(balance, 100, "should have been approved tokens");
      console.log(`Gas for EC20 approve: ${txReceipt.gasUsed}`);
    });
  });

  describe("transfer ERC721", () => {
    let erc721;
    const tokenId = 7;

    beforeEach(async () => {
      await initNonce(wallet, module, manager, SECURITY_PERIOD);

      erc721 = await ERC721.new();
      await erc721.mint(wallet.address, tokenId);
    });

    it("should send an ERC721 to a whitelisted address", async () => {
      await addTrustedContact(wallet, recipient, module, SECURITY_PERIOD);

      const data = erc721.contract.methods.safeTransferFrom(wallet.address, recipient, tokenId).encodeABI();
      const transaction = encodeTransaction(erc721.address, 0, data);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      console.log(`Gas for ERC721 transfer: ${txReceipt.gasUsed}`);
    });
  });
});
