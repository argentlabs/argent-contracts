/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");
const WalletFactory = artifacts.require("WalletFactory");

const utils = require("../utils/utilities.js");
const { setupWalletVersion } = require("../utils/wallet_definition.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;

contract("WalletFactory", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian = accounts[4];

  let factory;

  before(async () => {
    const modules = await setupWalletVersion({ });
    registry = modules.registry;

    factory = await WalletFactory.new();
    await factory.addVersion(registry.address);
    await factory.addManager(infrastructure);
  });

  describe("Create wallets with CREATE", () => {
    it("should create with the correct owner", async () => {
      // we create the wallet
      const tx = await factory.createWallet(owner, guardian);
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet has the correct owner
      const wallet = await IWallet.at(walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "should have the correct owner");
    });

    it("should create with the correct guardian", async () => {
      // we create the wallet
      const tx = await factory.createWallet(owner, guardian);
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet has the correct guardian
      const wallet = await IWallet.at(walletAddr);
      const success = await wallet.isGuardian(guardian);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should fail to create when the guardian is empty", async () => {
      // we create the wallet
      await truffleAssert.reverts(factory.createWallet(owner, ZERO_ADDRESS),
        "WF: guardian cannot be null");
    });

    it("should fail to create with zero address as owner", async () => {
      await truffleAssert.reverts(
        factory.createWallet(ethers.constants.AddressZero, guardian),
        "WF: owner cannot be null",
      );
    });
  });

  describe("Create wallets with CREATE2", () => {
    it("should create a wallet at the correct address", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, guardian, salt, 1,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct owner", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(owner, guardian, salt, 1);
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct owner
      const wallet = await IWallet.at(walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "should have the correct owner");
    });

    it("should create with the correct guardian", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(owner, guardian, salt, 1);
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct guardian
      const wallet = await IWallet.at(walletAddr);
      const success = await wallet.isGuardian(guardian);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should fail to create a wallet at an existing address", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, guardian, salt, 1);
      // we create the first wallet
      const tx = await factory.createCounterfactualWallet(owner, guardian, salt, 1);
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, event.args.wallet, "should have the correct address");
      // we create the second wallet
      await truffleAssert.reverts(factory.createCounterfactualWallet(owner, guardian, salt, 1));
    });

    it("should fail to create when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, ZERO_ADDRESS, salt, 1),
        "WF: guardian cannot be null",
      );
    });

    it.skip("should emit and event when the balance is non zero at creation", async () => {
      const salt = utils.generateSaltValue();
      const amount = 10000000000000;
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, guardian, salt, 1);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: amount });
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(owner, guardian, salt, 1);
      const wallet = await DelegateProxy.at(futureAddr);
      const event = await utils.getEvent(tx.receipt, wallet, "Received");
      assert.equal(event.args.value, amount, "should log the correct amount");
      assert.equal(event.args.sender, "0x0000000000000000000000000000000000000000", "sender should be address(0)");
    });

    it("should fail to get an address when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.getAddressForCounterfactualWallet(owner, ZERO_ADDRESS, salt, 1),
        "WF: guardian cannot be null",
      );
    });
  });
});
