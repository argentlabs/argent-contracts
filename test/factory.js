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
    await factory.changeRefundAddress(refundAddress);

    versionManager = await deployVersionManager();
    await moduleRegistry.registerModule(versionManager.address, ethers.utils.formatBytes32String("versionManager"));
  });

  describe("Create and configure the factory", () => {
    it("should not allow to be created with empty WalletImplementation", async () => {
      await truffleAssert.reverts(Factory.new(
        ZERO_ADDRESS,
        guardianStorage.address,
        refundAddress), "WF: WalletImplementation address not defined");
    });

    it("should not allow to be created with empty GuardianStorage", async () => {
      await truffleAssert.reverts(Factory.new(
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

    it("should allow owner to change the refund address", async () => {
      const randomAddress = utils.getRandomAddress();
      await factory.changeRefundAddress(randomAddress);
      const updatedRefundAddress = await factory.refundAddress();
      assert.equal(updatedRefundAddress, randomAddress);
    });

    it("should not allow owner to change the refund address to zero address", async () => {
      await truffleAssert.reverts(factory.changeRefundAddress(ZERO_ADDRESS), "WF: address cannot be null");
    });

    it("should fail to create with owner as guardian", async () => {
      await truffleAssert.reverts(
        factory.createWallet(owner, versionManager.address, owner, 1),
        "WF: owner cannot be guardian",
      );
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

    async function testCreateWallet({from, version = 1}) {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, version);
      
      let r;
      let s;
      let v;
      if (from === infrastructure) {
        [r, s, v] = ["0x", "0x", 0];
      } else {
        const msg = ethers.utils.hexZeroPad(futureAddr, 32);
        const sig = await utils.signMessage(msg, infrastructure);
        r = `0x${sig.substring(2, 66)}`;
        s = `0x${sig.substring(66, 130)}`;
        v = parseInt(sig.substring(130, 132), 16);
      }
      
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, version, 0, ZERO_ADDRESS, ZERO_BYTES32, r, s, v, { from }
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct owner
      const wallet = await BaseWallet.at(walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "should have the correct owner");
      // we test that the wallet has the correct modules
      const isAuthorised = await wallet.authorised(versionManager.address);
      assert.equal(isAuthorised, true, "versionManager should be authorised");
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian);
      assert.equal(success, true, "should have the correct guardian");
    }

    it("should let a manager create a wallet with the correct (owner, modules, guardian) properties", async () => {
      await testCreateWallet({from: infrastructure});
    });

    it("should let anyone (possessing the right signature) create a wallet with the correct (owner, modules, guardian) properties", async () => {
      await testCreateWallet({from: owner});
    });

    it("should create when the target version was blacklisted", async () => {
      const badVersion = await versionManager.lastVersion();
      await versionManager.addVersion([], []);
      await versionManager.setMinVersion(await versionManager.lastVersion());

      await testCreateWallet({from: owner,version:badVersion});
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
        owner, versionManager.address, guardian, salt, 1, refundAmount, ETH_TOKEN, ownerSig, "0x", "0x", 0
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore).toNumber(), refundAmount, "should have refunded in ETH");

      assert.equal(event.args.refundToken, ETH_TOKEN);
      assert.equal(event.args.refundAmount, refundAmount);
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
        owner, versionManager.address, guardian, salt, 1, refundAmount, token.address, ownerSig, "0x", "0x", 0
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;

      const balanceAfter = await token.balanceOf(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore).toNumber(), refundAmount, "should have refunded in token");

      assert.equal(event.args.refundToken, token.address);
      assert.equal(event.args.refundAmount, refundAmount);
    });

    it("should create but not refund when an invalid refund amount is provided", async () => {
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
        owner, versionManager.address, guardian, salt, 1, 2 * refundAmount, ETH_TOKEN, ownerSig, "0x", "0x", 0
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was refunded
      assert.equal(balanceAfter.sub(balanceBefore), 0, "should not have refunded");
    });

    it("should create but not refund when an invalid signature is provided", async () => {
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
        owner, versionManager.address, guardian, salt, 1, refundAmount, ETH_TOKEN, otherSig, "0x", "0x", 0
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
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32, "0x", "0x", 0
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, event.args.wallet, "should have the correct address");
      // we create the second wallet
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32, "0x", "0x", 0)
      );
    });

    it("should fail to create when there is not enough for the refund", async () => {
      const refundAmount = 1000;
      const salt = utils.generateSaltValue();

      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // Send less ETH than the refund
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: 900 });

      // we get the owner signature for a refund
      const ownerSig = await signRefund(refundAmount, ETH_TOKEN, owner);
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, guardian, salt, 1, refundAmount, ETH_TOKEN, ownerSig, "0x", "0x", 0)
      );
    });

    it("should fail to create counterfactually when there are no modules (with guardian)", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(
          owner, ethers.constants.AddressZero, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32, "0x", "0x", 0
        ),
        "WF: invalid _versionManager",
      );
    });

    it("should fail to create when the owner is empty", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(ZERO_ADDRESS, versionManager.address, guardian, salt, 1, "0x", "0x", 0),
        "WF: owner cannot be null",
      );
    });

    it("should fail to create when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, ZERO_ADDRESS, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,"0x", "0x", 0),
        "WF: guardian cannot be null",
      );
    });

    it("should fail to create when the owner is the guardian", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, owner, salt, 1, "0x", "0x", 0),
        "WF: owner cannot be guardian",
      );
    });

    it("should fail to create when the version is 0", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, guardian, salt, 0, "0x", "0x", 0),
        "WF: invalid _version",
      );
    });

    it("should fail to create by a non-manager without a manager's signature", async () => {
      const salt = utils.generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, versionManager.address, guardian, salt, 1, "0x", "0x", 0, { from: other }),
        "WF: unauthorised wallet creation",
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
        owner, versionManager.address, guardian, salt, 1, 0, ZERO_ADDRESS, ZERO_BYTES32,"0x", "0x", 0
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

  describe("Managed-like contract logic", () => {
    it("should not be able to add manager if not called by owner", async () => {
      await truffleAssert.reverts(factory.addManager(other, { from: other }), "Must be owner");
    });

    it("should not be able to set manager to zero address", async () => {
      await truffleAssert.reverts(factory.addManager(ethers.constants.AddressZero), "M: Address must not be null");
    });

    it("should be able to set manager twice without error", async () => {
      // Set manager once
      await factory.addManager(other);
      let isManager = await factory.managers(other);
      assert.isTrue(isManager);

      // Set manager twice
      await factory.addManager(other);
      isManager = await factory.managers(other);
      assert.isTrue(isManager);
    });
  });
});
