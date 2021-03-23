/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("ModuleRegistry");
const BaseWallet = artifacts.require("BaseWallet");
const Factory = artifacts.require("WalletFactory");
const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");
const ArgentModule = artifacts.require("ArgentModule");
const ERC20 = artifacts.require("TestERC20");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const ZERO_BYTES = "0x";

const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

contract("WalletFactory", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian = accounts[4];
  const other = accounts[6];
  const refundAddress = accounts[7];

  let implementation;
  let guardianStorage;
  let factory;
  let transferStorage;
  let modules;
  let module;
  let registry;

  before(async () => {
    registry = await Registry.new();

    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();

    const uniswapRouter = await UniswapV2Router01.new();

    implementation = await BaseWallet.new();
    guardianStorage = await GuardianStorage.new();
    factory = await Factory.new(
      implementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);
    transferStorage = await TransferStorage.new();

    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      ZERO_ADDRESS,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));

    modules = [module.address];
  });

  async function signRefund(wallet, amount, token, signer) {
    const message = `0x${[
      wallet,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(amount), 32),
      token,
    ].map((hex) => hex.slice(2)).join("")}`;
    const sig = await utils.signMessage(ethers.utils.keccak256(message), signer);
    return sig;
  }

  function generateSaltValue() {
    return ethers.utils.hexZeroPad(
      ethers.BigNumber.from(ethers.utils.randomBytes(20)).toHexString(),
      20,
    );
  }

  beforeEach(async () => {
    // Restore the good state of factory (we use bad addresses in some tests)
    await factory.changeRefundAddress(refundAddress);
  });

  describe("Create and configure the factory", () => {
    it("should not allow to be created with empty WalletImplementation", async () => {
      await truffleAssert.reverts(Factory.new(
        ZERO_ADDRESS,
        guardianStorage.address,
        refundAddress), "WF: empty wallet implementation");
    });

    it("should not allow to be created with empty GuardianStorage", async () => {
      await truffleAssert.reverts(Factory.new(
        implementation.address,
        ZERO_ADDRESS,
        refundAddress), "WF: empty guardian storage");
    });

    it("should not allow to be created with empty refund address", async () => {
      await truffleAssert.reverts(Factory.new(
        implementation.address,
        guardianStorage.address,
        ZERO_ADDRESS), "WF: empty refund address");
    });

    it("should allow owner to change the refund address", async () => {
      const randomAddress = utils.getRandomAddress();
      await factory.changeRefundAddress(randomAddress);
      const updatedRefundAddress = await factory.refundAddress();
      assert.equal(updatedRefundAddress, randomAddress);
    });

    it("should not allow owner to change the refund address to zero address", async () => {
      await truffleAssert.reverts(factory.changeRefundAddress(ZERO_ADDRESS), "WF: cannot set to empty");
    });

    it("should not allow non-owner to change the refund address", async () => {
      const randomAddress = utils.getRandomAddress();
      await truffleAssert.reverts(factory.changeRefundAddress(randomAddress, { from: other }), "Must be owner");
    });
  });

  describe("Create wallets with CREATE2", () => {
    it("should let a manager create a wallet with the correct (owner, modules, guardian) properties", async () => {
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);

      const managerSig = "0x";

      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, managerSig, { from: infrastructure });

      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");

      const wallet = await BaseWallet.at(walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "should have the correct owner");
      // we test that the wallet has the correct modules
      const isAuthorised = await wallet.authorised(module.address);
      assert.equal(isAuthorised, true, "module should be authorised");
      const count = await wallet.modules();
      assert.equal(count, 1, "1 module should be authorised");
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should let anyone (possessing the right signature) create a wallet with the correct (owner, modules, guardian) properties", async () => {
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);

      const msg = ethers.utils.hexZeroPad(futureAddr, 32);
      const managerSig = await utils.signMessage(msg, infrastructure);

      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, managerSig, { from: owner });

      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct static calls", async () => {
      const salt = generateSaltValue();

      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);

      const msg = ethers.utils.hexZeroPad(futureAddr, 32);
      const managerSig = await utils.signMessage(msg, infrastructure);
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, managerSig, { from: owner });
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const wallet = await BaseWallet.at(walletAddr);

      const ERC1271_ISVALIDSIGNATURE_BYTES32 = utils.sha3("isValidSignature(bytes32,bytes)").slice(0, 10);
      const isValidSignatureDelegate = await wallet.enabled(ERC1271_ISVALIDSIGNATURE_BYTES32);
      assert.equal(isValidSignatureDelegate, module.address);

      const ERC721_RECEIVED = utils.sha3("onERC721Received(address,address,uint256,bytes)").slice(0, 10);
      const isERC721Received = await wallet.enabled(ERC721_RECEIVED);
      assert.equal(isERC721Received, module.address);
    });

    it("should create and refund in ETH when a valid signature is provided", async () => {
      const refundAmount = 1000;
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: refundAmount });
      // we get the owner signature for the refund
      const ownerSig = await signRefund(futureAddr, refundAmount, ETH_TOKEN, owner);
      // we create the wallet
      const balanceBefore = await utils.getBalance(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, refundAmount, ETH_TOKEN, ownerSig, "0x",
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
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // We create an ERC20 token and give some to the wallet
      const token = await ERC20.new([infrastructure, futureAddr], 10000000, 12);
      // we get the owner signature for the refund
      const ownerSig = await signRefund(futureAddr, refundAmount, token.address, owner);
      // we create the wallet
      const balanceBefore = await token.balanceOf(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, refundAmount, token.address, ownerSig, "0x"
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
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: refundAmount });
      // we get the owner signature for the refund
      const ownerSig = await signRefund(futureAddr, refundAmount, ETH_TOKEN, owner);
      // we create the wallet
      const balanceBefore = await utils.getBalance(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, 2 * refundAmount, ETH_TOKEN, ownerSig, "0x"
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
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: refundAmount });
      // we get the owner signature for the refund
      const otherSig = await signRefund(futureAddr, refundAmount, ETH_TOKEN, other);
      // we create the wallet
      const balanceBefore = await utils.getBalance(refundAddress);
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, refundAmount, ETH_TOKEN, otherSig, "0x"
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the creation was not refunded
      assert.equal(balanceAfter.sub(balanceBefore), 0, "should not have refunded");
    });

    it("should create but not refund when a replayed owner signature is provided", async () => {
      const refundAmount = 1000;
      // Create the signature for the first wallet with owner account
      const salt1 = generateSaltValue();
      const futureAddr1 = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt1);
      const ownerSig = await signRefund(futureAddr1, refundAmount, ETH_TOKEN, owner);

      // Create a second wallet with the same ownerSig
      const salt2 = generateSaltValue();
      const futureAddr2 = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt2);
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr2, value: refundAmount });

      const balanceBefore = await utils.getBalance(refundAddress);
      const tx2 = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt2, refundAmount, ETH_TOKEN, ownerSig, "0x",
      );
      const event = await utils.getEvent(tx2.receipt, factory, "WalletCreated");
      const walletAddr = event.args.wallet;
      assert.equal(futureAddr2, walletAddr, "should have the correct address");
      const balanceAfter = await utils.getBalance(refundAddress);
      // we test that the creation was not refunded
      assert.equal(balanceAfter.sub(balanceBefore), 0, "should not have refunded");
    });

    it("should fail to create a wallet at an existing address", async () => {
      const salt = generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // we create the first wallet
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x"
      );
      const event = await utils.getEvent(tx.receipt, factory, "WalletCreated");
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, event.args.wallet, "should have the correct address");
      // we create the second wallet
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x")
      );
    });

    it("should fail to create when there is not enough for the refund", async () => {
      const refundAmount = 1000;
      const salt = generateSaltValue();

      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // Send less ETH than the refund
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: 900 });

      // we get the owner signature for a refund
      const ownerSig = await signRefund(futureAddr, refundAmount, ETH_TOKEN, owner);
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, modules, guardian, salt, refundAmount, ETH_TOKEN, ownerSig, "0x")
      );
    });

    it("should fail to create counterfactually when there are no modules (with guardian)", async () => {
      const salt = generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(
          owner, [ethers.constants.AddressZero], guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x"
        ));
    });

    it("should fail to create when the owner is empty", async () => {
      const salt = generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(ZERO_ADDRESS, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x"),
        "WF: empty owner address",
      );
    });

    it("should fail to create when the guardian is empty", async () => {
      const salt = generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, modules, ZERO_ADDRESS, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x"),
        "WF: empty guardian",
      );
    });

    it("should fail to create when the owner is the guardian", async () => {
      const salt = generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, modules, owner, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x"),
        "WF: owner cannot be guardian",
      );
    });

    it("should fail to create by a non-manager without a manager's signature", async () => {
      const salt = generateSaltValue();
      await truffleAssert.reverts(
        factory.createCounterfactualWallet(owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x", { from: other }),
        "WF: unauthorised wallet creation",
      );
    });

    it("should emit and event when the balance is non zero at creation", async () => {
      const salt = generateSaltValue();
      const amount = 10000000000000;
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, modules, guardian, salt);
      // We send ETH to the address
      await web3.eth.sendTransaction({ from: infrastructure, to: futureAddr, value: amount });
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, modules, guardian, salt, 0, ZERO_ADDRESS, ZERO_BYTES, "0x"
      );
      const wallet = await BaseWallet.at(futureAddr);
      const event = await utils.getEvent(tx.receipt, wallet, "Received");
      assert.equal(event.args.value, amount, "should log the correct amount");
      assert.equal(event.args.sender, "0x0000000000000000000000000000000000000000", "sender should be address(0)");
    });

    it("should fail to get an address when the guardian is empty", async () => {
      const salt = generateSaltValue();
      await truffleAssert.reverts(
        factory.getAddressForCounterfactualWallet(owner, modules, ZERO_ADDRESS, salt),
        "WF: empty guardian",
      );
    });
  });

  describe("Managed-like contract logic", () => {
    it("should not be able to revoke a manager", async () => {
      await truffleAssert.reverts(factory.revokeManager(infrastructure), "WF: managers can't be revoked");
    });

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
