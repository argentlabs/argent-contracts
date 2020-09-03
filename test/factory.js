/* global accounts, utils */
const ethers = require("ethers");

const BaseWallet = require("../build/BaseWallet");
const VersionManager = require("../build/VersionManager");
const ModuleRegistry = require("../build/ModuleRegistry");
const ENSRegistry = require("../build/ENSRegistry");
const ENSRegistryWithFallback = require("../build/ENSRegistryWithFallback");
const ENSManager = require("../build/ArgentENSManager");
const ENSResolver = require("../build/ArgentENSResolver");
const ENSReverseRegistrar = require("../build/ReverseRegistrar");
const Factory = require("../build/WalletFactory");
const GuardianStorage = require("../build/GuardianStorage");

const TestManager = require("../utils/test-manager");
const utilities = require("../utils/utilities.js");

const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const NO_ENS = "";

describe("Wallet Factory", function () {
  this.timeout(10000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const guardian = accounts[4].signer;
  const other = accounts[6].signer;

  const root = "xyz";
  const subnameWallet = "argent";
  const walletNode = ethers.utils.namehash(`${subnameWallet}.${root}`);

  let index = 0;

  let deployer;
  let ensRegistry;
  let ensResolver;
  let ensReverse;
  let ensManager;
  let implementation;
  let moduleRegistry;
  let guardianStorage;
  let factory;
  let module1;
  let module2;

  before(async () => {
    deployer = manager.newDeployer();
    const ensRegistryWithoutFallback = await deployer.deploy(ENSRegistry);
    ensRegistry = await deployer.deploy(ENSRegistryWithFallback, {}, ensRegistryWithoutFallback.contractAddress);
    ensResolver = await deployer.deploy(ENSResolver);
    ensReverse = await deployer.deploy(ENSReverseRegistrar, {}, ensRegistry.contractAddress, ensResolver.contractAddress);
    ensManager = await deployer.deploy(ENSManager, {}, `${subnameWallet}.${root}`,
      walletNode, ensRegistry.contractAddress, ensResolver.contractAddress);
    await ensResolver.addManager(ensManager.contractAddress);
    await ensResolver.addManager(infrastructure.address);
    await ensManager.addManager(infrastructure.address);

    await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(root)), infrastructure.address);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash(root), ethers.utils.keccak256(ethers.utils.toUtf8Bytes(subnameWallet)), ensManager.contractAddress,
    );
    await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes("reverse")), infrastructure.address);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash("reverse"), ethers.utils.keccak256(ethers.utils.toUtf8Bytes("addr")), ensReverse.contractAddress,
    );

    implementation = await deployer.deploy(BaseWallet);
    moduleRegistry = await deployer.deploy(ModuleRegistry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    factory = await deployer.deploy(Factory, {},
      moduleRegistry.contractAddress,
      implementation.contractAddress,
      ensManager.contractAddress,
      guardianStorage.contractAddress);
    await factory.addManager(infrastructure.address);
    await ensManager.addManager(factory.contractAddress);
  });

  async function deployTestModule() {
    const module = await deployer.deploy(VersionManager, {}, 
      moduleRegistry.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    await module.addVersion([],[]);
    return module;
  }

  beforeEach(async () => {
    // Restore the good state of factory (we set these to bad addresses in some tests)
    await factory.changeModuleRegistry(moduleRegistry.contractAddress);
    await factory.changeENSManager(ensManager.contractAddress);

    module1 = await deployTestModule()
    module2 = await deployTestModule()
    await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
    await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));

    index += 1;
  });

  describe("Create and configure the factory", () => {
    it("should not allow to be created with empty ModuleRegistry", async () => {
      await assert.revertWith(deployer.deploy(Factory, {},
        ZERO_ADDRESS,
        implementation.contractAddress,
        ensManager.contractAddress,
        guardianStorage.contractAddress), "WF: ModuleRegistry address not defined");
    });

    it("should not allow to be created with empty WalletImplementation", async () => {
      await assert.revertWith(deployer.deploy(Factory, {},
        moduleRegistry.contractAddress,
        ZERO_ADDRESS,
        ensManager.contractAddress,
        guardianStorage.contractAddress), "WF: WalletImplementation address not defined");
    });

    it("should not allow to be created with empty ENSManager", async () => {
      await assert.revertWith(deployer.deploy(Factory, {},
        moduleRegistry.contractAddress,
        implementation.contractAddress,
        ZERO_ADDRESS,
        guardianStorage.contractAddress), "WF: ENSManager address not defined");
    });

    it("should not allow to be created with empty GuardianStorage", async () => {
      await assert.revertWith(deployer.deploy(Factory, {},
        moduleRegistry.contractAddress,
        implementation.contractAddress,
        ensManager.contractAddress,
        ZERO_ADDRESS), "WF: GuardianStorage address not defined");
    });

    it("should allow owner to change the module registry", async () => {
      const randomAddress = utilities.getRandomAddress();
      await factory.changeModuleRegistry(randomAddress);
      const updatedModuleRegistry = await factory.moduleRegistry();
      assert.equal(updatedModuleRegistry, randomAddress);
    });

    it("should not allow owner to change the module registry to zero address", async () => {
      await assert.revertWith(factory.changeModuleRegistry(ethers.constants.AddressZero), "WF: address cannot be null");
    });

    it("should not allow non-owner to change the module registry", async () => {
      const randomAddress = utilities.getRandomAddress();
      await assert.revertWith(factory.from(other).changeModuleRegistry(randomAddress), "Must be owner");
    });

    it("should allow owner to change the ens manager", async () => {
      const randomAddress = utilities.getRandomAddress();
      await factory.changeENSManager(randomAddress);
      const updatedEnsManager = await factory.ensManager();
      assert.equal(updatedEnsManager, randomAddress);
    });

    it("should not allow owner to change the ens manager to a zero address", async () => {
      await assert.revertWith(factory.changeENSManager(ethers.constants.AddressZero), "WF: address cannot be null");
    });

    it("should not allow non-owner to change the ens manager", async () => {
      const randomAddress = utilities.getRandomAddress();
      await assert.revertWith(factory.from(other).changeENSManager(randomAddress), "Must be owner");
    });

    it("should return the correct ENSManager", async () => {
      const ensManagerOnFactory = await factory.ensManager();
      assert.equal(ensManagerOnFactory, ensManager.contractAddress, "should have the correct ENSManager addrress");
    });
  });

  describe("Create wallets with CREATE", () => {
    it("should create with the correct owner", async () => {
      // we create the wallet
      const label = `wallet${index}`;
      const modules = [module1.contractAddress];
      const tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct owner
      const wallet = await deployer.wrapDeployedContract(BaseWallet, walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner.address, "should have the correct owner");
    });

    it("should create with the correct modules", async () => {
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      // we create the wallet
      const tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct modules
      const wallet = await deployer.wrapDeployedContract(BaseWallet, walletAddr);
      let isAuthorised = await wallet.authorised(module1.contractAddress);
      assert.equal(isAuthorised, true, "module1 should be authorised");
      isAuthorised = await wallet.authorised(module2.contractAddress);
      assert.equal(isAuthorised, true, "module2 should be authorised");
    });

    it("should create with the correct guardian", async () => {
      // we create the wallet
      const label = `wallet${index}`;
      const modules = [module1.contractAddress];
      const tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian.address);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should create with the correct ENS name", async () => {
      const label = `wallet${index}`;
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      const modules = [module1.contractAddress, module2.contractAddress];
      // we create the wallet
      const tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet has the correct ENS
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, walletAddr);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.contractAddress);
    });

    it("should create when there is no ENS", async () => {
      const modules = [module1.contractAddress, module2.contractAddress];
      // we create the wallet
      const tx = await factory.from(infrastructure).createWallet(owner.address, modules, NO_ENS, guardian.address);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      assert.notEqual(walletAddr, ZERO_ADDRESS, "wallet should be created");
    });

    it("should fail to create when the guardian is empty", async () => {
      // we create the wallet
      const label = `wallet${index}`;
      const modules = [module1.contractAddress];
      await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label, ZERO_ADDRESS),
        "WF: guardian cannot be null");
    });

    it("should fail to create when there are no modules", async () => {
      const label = `wallet${index}`;
      const modules = [];
      await assert.revertWith(factory.from(deployer).createWallet(owner.address, modules, label, guardian.address),
        "WF: cannot assign with less than 1 module");
    });

    it("should fail to create with an existing ENS", async () => {
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      await factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address);
      await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address),
        "AEM: _label is alrealdy owned");
    });

    it("should fail to create with zero address as owner", async () => {
      const label = `wallet${index}`;
      const modules = [module1.contractAddress];
      await assert.revertWith(factory.from(infrastructure).createWallet(ethers.constants.AddressZero, modules, label, guardian.address),
        "WF: owner cannot be null");
    });

    it("should fail to create with no modules", async () => {
      const label = `wallet${index}`;
      const modules = [];
      await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address),
        "WF: cannot assign with less than 1 module");
    });

    it("should fail to create with unregistered module", async () => {
      const label = `wallet${index}`;
      const randomAddress = utilities.getRandomAddress();
      const modules = [randomAddress];
      await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label, guardian.address),
        "WF: one or more modules are not registered");
    });
  });

  describe("Create wallets with CREATE2", () => {
    beforeEach(async () => {
      module1 = await deployTestModule()
      module2 = await deployTestModule()
      await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
      await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
    });

    it("should create a wallet at the correct address", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct owner", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct owner
      const wallet = await deployer.wrapDeployedContract(BaseWallet, walletAddr);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner.address, "should have the correct owner");
    });

    it("should create with the correct modules", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct modules
      const wallet = await deployer.wrapDeployedContract(BaseWallet, walletAddr);
      let isAuthorised = await wallet.authorised(module1.contractAddress);
      assert.equal(isAuthorised, true, "module1 should be authorised");
      isAuthorised = await wallet.authorised(module2.contractAddress);
      assert.equal(isAuthorised, true, "module2 should be authorised");
    });

    it("should create with the correct ENS name", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct ENS
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, walletAddr);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.contractAddress);
    });

    it("should create when there is no ENS", async () => {
      const salt = utilities.generateSaltValue();
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the wallet
      const tx = await factory.from(deployer).createCounterfactualWallet(owner.address, modules, NO_ENS, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
    });

    it("should create with the correct guardian", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we test that the wallet has the correct guardian
      const success = await guardianStorage.isGuardian(walletAddr, guardian.address);
      assert.equal(success, true, "should have the correct guardian");
    });

    it("should fail to create a wallet at an existing address", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // we create the first wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const walletAddr = txReceipt.events.filter((event) => event.event === "WalletCreated")[0].args.wallet;
      // we test that the wallet is at the correct address
      assert.equal(futureAddr, walletAddr, "should have the correct address");
      // we create the second wallet
      await assert.revert(factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt),
        "should fail when address is in use");
    });

    it("should fail to create counterfactually when there are no modules (with guardian)", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [];
      await assert.revertWith(factory.from(deployer).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt),
        "WF: cannot assign with less than 1 module");
    });

    it("should fail to create when the guardian is empty", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      await assert.revertWith(factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, ZERO_ADDRESS, salt),
        "WF: guardian cannot be null");
    });

    it("should emit and event when the balance is non zero at creation", async () => {
      const salt = utilities.generateSaltValue();
      const label = `wallet${index}`;
      const modules = [module1.contractAddress, module2.contractAddress];
      const amount = ethers.BigNumber.from("10000000000000");
      // we get the future address
      const futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, guardian.address, salt);
      // We send ETH to the address
      await infrastructure.sendTransaction({ to: futureAddr, value: amount });
      // we create the wallet
      const tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, guardian.address, salt);
      const txReceipt = await factory.verboseWaitForTransaction(tx);
      const wallet = deployer.wrapDeployedContract(BaseWallet, futureAddr);
      assert.isTrue(await utils.hasEvent(txReceipt, wallet, "Received"), "should have generated Received event");
      const log = await utils.parseLogs(txReceipt, wallet, "Received");
      assert.equal(log[0].value.toNumber(), amount, "should log the correct amount");
      assert.equal(log[0].sender, "0x0000000000000000000000000000000000000000", "sender should be address(0)");
    });

    it("should fail to get an address when the guardian is empty", async () => {
      const salt = utilities.generateSaltValue();
      const modules = [module1.contractAddress, module2.contractAddress];
      await assert.revertWith(factory.from(infrastructure).getAddressForCounterfactualWallet(owner.address, modules, ZERO_ADDRESS, salt),
        "WF: guardian cannot be null");
    });
  });
});
