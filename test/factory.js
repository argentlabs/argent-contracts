/* global artifacts */
const ethers = require("ethers");

const BaseWallet = artifacts.require("BaseWallet");
const VersionManager = artifacts.require("VersionManager");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const Factory = artifacts.require("WalletFactory");
const GuardianStorage = artifacts.require("GuardianStorage");

const utils = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;

contract("WalletFactory", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian = accounts[4];
  const other = accounts[6];

  let deployer;

  let implementation;
  let moduleRegistry;
  let guardianStorage;
  let factory;
  let versionManager;

  before(async () => {
    deployer = manager.newDeployer();

    implementation = await BaseWallet.new();
    moduleRegistry = await ModuleRegistry.new();
    guardianStorage = await GuardianStorage.new();
    factory = await Factory.new(
      moduleRegistry.address,
      implementation.address,
      guardianStorage.address);
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

  beforeEach(async () => {
    // Restore the good state of factory (we set these to bad addresses in some tests)
    await factory.changeModuleRegistry(moduleRegistry.address);

    versionManager = await deployVersionManager();
    await moduleRegistry.registerModule(versionManager.address, ethers.utils.formatBytes32String("versionManager"));
  });

  describe("Create and configure the factory", () => {
    it("should not allow to be created with empty ModuleRegistry", async () => {
      await utils.assertRevert(Factory.new(
        ZERO_ADDRESS,
        implementation.address,
        guardianStorage.address), "WF: ModuleRegistry address not defined");
    });

    it("should not allow to be created with empty WalletImplementation", async () => {
      await utils.assertRevert(Factory.new(
        moduleRegistry.address,
        ZERO_ADDRESS,
        guardianStorage.address), "WF: WalletImplementation address not defined");
    });

    it("should not allow to be created with empty GuardianStorage", async () => {
      await utils.assertRevert(deployer.deploy(Factory, {},
        moduleRegistry.address,
        implementation.address,
        ZERO_ADDRESS), "WF: GuardianStorage address not defined");
    });

    it("should allow owner to change the module registry", async () => {
      const randomAddress = utils.getRandomAddress();
      await factory.changeModuleRegistry(randomAddress);
      const updatedModuleRegistry = await factory.moduleRegistry();
      assert.equal(updatedModuleRegistry, randomAddress);
    });

    it("should not allow owner to change the module registry to zero address", async () => {
      await utils.assertRevert(factory.changeModuleRegistry(ethers.constants.AddressZero), "WF: address cannot be null");
    });

    it("should not allow non-owner to change the module registry", async () => {
      const randomAddress = utils.getRandomAddress();
      await utils.assertRevert(factory.changeModuleRegistry(randomAddress, { from: other }), "Must be owner");
    });

    it("should allow owner to change the ens manager", async () => {
      const randomAddress = utils.getRandomAddress();
      await factory.changeENSManager(randomAddress);
      const updatedEnsManager = await factory.ensManager();
      assert.equal(updatedEnsManager, randomAddress);
    });

    it("should not allow owner to change the ens manager to a zero address", async () => {
      await utils.assertRevert(factory.changeENSManager(ethers.constants.AddressZero), "WF: address cannot be null");
    });

    it("should not allow non-owner to change the ens manager", async () => {
      const randomAddress = utils.getRandomAddress();
      await utils.assertRevert(factory.changeENSManager(randomAddress, { from: owner }), "Must be owner");
    });

    it("should return the correct ENSManager", async () => {
      const ensManagerOnFactory = await factory.ensManager();
      assert.equal(ensManagerOnFactory, ensManager.address, "should have the correct ENSManager addrress");
    });
  });

  describe("Create wallets with CREATE", () => {
    it("should create with the correct owner", async () => {
      // we create the wallet
      const tx = await factory.createWallet(owner, versionManager.address, guardian, 1);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct owner
      const wallet = await BaseWallet.at(walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "should have the correct owner");
    });

    it("should create with the correct module", async () => {
      // we create the wallet
      const tx = await factory.createWallet(owner, versionManager.address, guardian, 1);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct module
      const wallet = await deployer.wrapDeployedContract(BaseWallet, walletAddr);
      const isAuthorised = await wallet.authorised(versionManager.address);
      assert.equal(isAuthorised, true, "versionManager should be authorised");
    });

    it("should create with the correct guardian", async () => {
      // we create the wallet
      const tx = await factory.createWallet(owner, versionManager.address, guardian, 1);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should create when the target version was blacklisted", async () => {
      const badVersion = await versionManager.lastVersion();
      await versionManager.addVersion([], []);
      await versionManager.setMinVersion(await versionManager.lastVersion());
      // we create the wallet
      const tx = await factory.createWallet(owner, versionManager.address, guardian, badVersion);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      assert.notEqual(walletAddr, ZERO_ADDRESS, "wallet should be created");
    });

    it("should fail to create when the guardian is empty", async () => {
      // we create the wallet
      await utils.assertRevert(factory.createWallet(owner, versionManager.address, ZERO_ADDRESS, 1),
        "WF: guardian cannot be null");
    });

    it("should fail to create when there are is no VersionManager", async () => {
      await utils.assertRevert(factory.createWallet(owner, ethers.constants.AddressZero, guardian, 1, { from: deployer }),
        "WF: invalid _versionManager");
    });

    it("should fail to create with zero address as owner", async () => {
      await utils.assertRevert(
        factory.createWallet(ethers.constants.AddressZero, versionManager.address, guardian, 1),
        "WF: owner cannot be null",
      );
    });

    it("should fail to create with unregistered module", async () => {
      const randomAddress = utils.getRandomAddress();
      await utils.assertRevert(factory.createWallet(owner, randomAddress, guardian, 1),
        "WF: invalid _versionManager");
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
        owner, versionManager.address, guardian, salt, 1,
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct owner", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1,
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
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
        owner, versionManager.address, guardian, salt, 1,
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct modules
      const wallet = await deployer.wrapDeployedContract(BaseWallet, walletAddr);
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
        owner, versionManager.address, guardian, salt, badVersion, { from: deployer }
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct guardian", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1,
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should fail to create a wallet at an existing address", async () => {
      const salt = utils.generateSaltValue();
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // we create the first wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1,
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we create the second wallet
      await assert.revert(
        factory.createCounterfactualWallet(owner, versionManager.address, guardian, salt, 1),
        "should fail when address is in use",
      );
    });

    it("should fail to create counterfactually when there are no modules (with guardian)", async () => {
      const salt = utils.generateSaltValue();
      await utils.assertRevert(
        factory.createCounterfactualWallet(
          owner, ethers.constants.AddressZero, guardian, salt, 1, { from: deployer }
        ),
        "invalid _versionManager",
      );
    });

    it("should fail to create when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await utils.assertRevert(
        factory.createCounterfactualWallet(owner, versionManager.address, ZERO_ADDRESS, salt, 1),
        "WF: guardian cannot be null",
      );
    });

    it("should emit and event when the balance is non zero at creation", async () => {
      const salt = utils.generateSaltValue();
      const amount = ethers.BigNumber.from("10000000000000");
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner, versionManager.address, guardian, salt, 1);
      // We send ETH to the address
      await futureAddr.send(amount);
      // we create the wallet
      const tx = await factory.createCounterfactualWallet(
        owner, versionManager.address, guardian, salt, 1,
      );
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const wallet = await BaseWallet.at(futureAddr);
      assert.isTrue(await utils.hasEvent(txReceipt, wallet, "Received"), "should have generated Received event");
      const log = await utils.parseLogs(txReceipt, wallet, "Received");
      assert.equal(log[0].value.toNumber(), amount, "should log the correct amount");
      assert.equal(log[0].sender, "0x0000000000000000000000000000000000000000", "sender should be address(0)");
    });

    it("should fail to get an address when the guardian is empty", async () => {
      const salt = utils.generateSaltValue();
      await utils.assertRevert(
        factory.getAddressForCounterfactualWallet(owner, versionManager.address, ZERO_ADDRESS, salt, 1),
        "WF: guardian cannot be null",
      );
    });
  });
});
