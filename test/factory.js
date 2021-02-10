/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const BaseWallet = artifacts.require("BaseWallet");
const VersionManager = artifacts.require("VersionManager");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const Factory = artifacts.require("WalletFactory");
const GuardianStorage = artifacts.require("GuardianStorage");
const ERC20 = artifacts.require("TestERC20");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const ZERO_BYTES32 = ethers.constants.HashZero;

contract("WalletFactory", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian = accounts[4];
  const other = accounts[6];
  const refundAddress = accounts[7];

  let implementation;
  let moduleRegistry;
  let guardianStorage;
  let factory;
  let versionManager;

  before(async () => {
    implementation = await BaseWallet.new();
    moduleRegistry = await ModuleRegistry.new();
    guardianStorage = await GuardianStorage.new();
    factory = await Factory.new(
      moduleRegistry.address,
      implementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);
  });

  async function deployVersionManager() {
    const vm = await VersionManager.new(
      moduleRegistry.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    await vm.addVersion([], []);
    return vm;
  }

  async function signRefund(amount, token, signer) {
    const message = `0x${[
      ethers.utils.hexZeroPad(ethers.utils.hexlify(amount), 32),
      token,
    ].map((hex) => hex.slice(2)).join("")}`;
    const sig = await utils.signMessage(ethers.utils.keccak256(message), signer);
    return sig;
  }

  beforeEach(async () => {
    // Restore the good state of factory (we set these to bad addresses in some tests)
    await factory.changeModuleRegistry(moduleRegistry.address);

    versionManager = await deployVersionManager();
    await moduleRegistry.registerModule(versionManager.address, ethers.utils.formatBytes32String("versionManager"));
  });

  describe("Create and configure the factory", () => {
    it("should not allow to be created with empty ModuleRegistry", async () => {
      await truffleAssert.reverts(Factory.new(
        ZERO_ADDRESS,
        implementation.address,
        guardianStorage.address,
        refundAddress), "WF: ModuleRegistry address not defined");
    });

    it("should not allow to be created with empty WalletImplementation", async () => {
      await truffleAssert.reverts(Factory.new(
        moduleRegistry.address,
        ZERO_ADDRESS,
        guardianStorage.address,
        refundAddress), "WF: WalletImplementation address not defined");
    });

    it("should not allow to be created with empty GuardianStorage", async () => {
      await truffleAssert.reverts(Factory.new(
        moduleRegistry.address,
        implementation.address,
        ZERO_ADDRESS,
        refundAddress), "WF: GuardianStorage address not defined");
    });

    it("should not allow to be created with empty refund address", async () => {
      await truffleAssert.reverts(Factory.new(
        moduleRegistry.address,
        implementation.address,
        guardianStorage.address,
        ZERO_ADDRESS), "WF: refund address not defined");
    });

    it("should allow owner to change the module registry", async () => {
      const randomAddress = utils.getRandomAddress();
      await factory.changeModuleRegistry(randomAddress);
      const updatedModuleRegistry = await factory.moduleRegistry();
      assert.equal(updatedModuleRegistry, randomAddress);
    });

    it("should allow owner to change the refund address", async () => {
      const randomAddress = utils.getRandomAddress();
      await factory.changeRefundAddress(randomAddress);
      const updatedRefundAddress = await factory.refundAddress();
      assert.equal(updatedRefundAddress, randomAddress);
    });

    it("should not allow owner to change the module registry to zero address", async () => {
      await truffleAssert.reverts(factory.changeModuleRegistry(ZERO_ADDRESS), "WF: address cannot be null");
    });

    it("should not allow owner to change the refund address to zero address", async () => {
      await truffleAssert.reverts(factory.changeRefundAddress(ZERO_ADDRESS), "WF: address cannot be null");
    });

    it("should not allow non-owner to change the module registry", async () => {
      const randomAddress = utils.getRandomAddress();
      await truffleAssert.reverts(factory.changeModuleRegistry(randomAddress, { from: other }), "Must be owner");
    });

    it("should not allow non-owner to change the refund address", async () => {
      const randomAddress = utils.getRandomAddress();
      await truffleAssert.reverts(factory.changeRefundAddress(randomAddress, { from: other }), "Must be owner");
    });
  });

  describe("Create wallets with CREATE2", () => {
    beforeEach(async () => {
      versionManager = await deployVersionManager();
      await moduleRegistry.registerModule(versionManager.address, ethers.utils.formatBytes32String("versionManager"));
    });

    it("should create a wallet at the correct address", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct owner", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct owner
      const wallet = await BaseWallet.at(walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "should have the correct owner");
    });

    it("should create with the correct modules", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct modules
      const wallet = await await BaseWallet.at(walletAddr);
      const isAuthorised = await wallet.authorised(versionManager.address);
      assert.equal(isAuthorised, true, "versionManager should be authorised");
    });

    it("should create when the target version was blacklisted", async () => {
      const badVersion = await versionManager.lastVersion();
      await versionManager.addVersion([], []);
      await versionManager.setMinVersion(await versionManager.lastVersion());

      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(
        owner, versionManager.address, guardian, salt, badVersion,
      );
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, badVersion, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct guardian", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should create and refund in ETH when a valid signature is provided", async () => {
      const refundAmount = 1000;
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: refundAmount });
      // we get the owner signature for the refund
      const ownerSig = await signRefund(refundAmount, ETH_TOKEN, owner);
      // we create the wallet
      const balanceBefore = await utils.getBalance(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, refundAmount, ETH_TOKEN, ownerSig,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore), refundAmount, "should have refunded in ETH");
    });

    it("should create and refund in ERC20 token when a valid signature is provided", async () => {
      const refundAmount = 1000;
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // We create an ERC20 token and give some to the wallet
      const token = await ERC20.new([infrastructure, futureAddr], 10000000, 12);
      // we get the owner signature for the refund
      const ownerSig = await signRefund(refundAmount, token.address, owner);
      // we create the wallet
      const balanceBefore = await token.balanceOf(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, refundAmount, token.address, ownerSig,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await token.balanceOf(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore), refundAmount, "should have refunded in token");
    });

    it("should create but not refund when an invalid signature is provided", async () => {
      const refundAmount = 1000;
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: refundAmount });
      // we get the owner signature for the refund
      const ownerSig = await signRefund(refundAmount, ETH_TOKEN, owner);
      // we create the wallet
      const balanceBefore = await utils.getBalance(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 2 * refundAmount, ETH_TOKEN, ownerSig,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore), 0, "should not have refunded");
    });

    it("should create but not refund when an invalid refund amount is provided", async () => {
      const refundAmount = 1000;
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: refundAmount });
      // we get the owner signature for the refund
      const otherSig = await signRefund(refundAmount, ETH_TOKEN, other);
      // we create the wallet
      const balanceBefore = await utils.getBalance(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, refundAmount, ETH_TOKEN, otherSig,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore), 0, "should not have refunded");
    });

    it("should fail to create a wallet at an existing address", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the first wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, event.args.wallet, "should have the correct address");
      // we create the second wallet
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32)
      );
    });

    it("should fail to create when there is not enough for the refund", async () => {
      const refundAmount = 1000;
      const salt = utils.generateSaltValue();
      // we get the owner signature for a refund
      const ownerSig = await signRefund(refundAmount, ETH_TOKEN, owner);
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, ZERO_ADDRESS, salt, 1, refundAmount, ETH_TOKEN, ownerSig),
      );
    });

    it("should fail to create counterfactually when there are no modules (with guardian)", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(
          owner, ethers.constants.AddressZero, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
        ),
        "WF: invalid _versionManager",
      );
    });

    it("should fail to create when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, ZERO_ADDRESS, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,),
        "WF: guardian cannot be null",
      );
    });

    it("should emit and event when the balance is non zero at creation", async () => {
      const salt = utils.generateSaltValue();
      const amount = 10000000000000;
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: amount });
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,
      );
      const wallet = await BaseWallet.at(futureAddr);
      const event = await utils.getEvent(tx.receipt, wallet, "Received");
      assert.equal(event.args.value, amount, "should log the correct amount");
      assert.equal(event.args.sender, "0x0000000000000000000000000000000000000000", "sender should be address(0)");
    });

    it("should fail to get an address when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.getAddressForCounterfactualWallet(owner, versionManager.address, ZERO_ADDRESS, salt, 1),
        "WF: guardian cannot be null",
      );
    });
  });
});
