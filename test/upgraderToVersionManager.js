/* global accounts */
const ethers = require("ethers");

const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const VersionManager = require("../build/VersionManager");
const TransferStorage = require("../build/TransferStorage");
const LockStorage = require("../build/LockStorage");
const GuardianStorage = require("../build/GuardianStorage");
const LimitStorage = require("../build/LimitStorage");
const RelayerManager = require("../build/RelayerManager");
const TransferManager = require("../build/TransferManager");
const LegacyTransferManager = require("../build-legacy/v1.6.0/TransferManager");
const UpgraderToVersionManager = require("../build/UpgraderToVersionManager");

const SECURITY_PERIOD = 3600;
const SECURITY_WINDOW = 3600;
const ETH_LIMIT = 1000000;

const TestManager = require("../utils/test-manager");

describe("UpgraderToVersionManager", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const owner = accounts[1].signer;
  const recipient = accounts[2].signer;

  let deployer;
  let transferStorage;
  let lockStorage;
  let guardianStorage;
  let limitStorage;
  let transferManager;
  let previousTransferManager;
  let wallet;
  let walletImplementation;
  let relayerManager;
  let versionManager;
  let upgrader;

  before(async () => {
    deployer = manager.newDeployer();
    walletImplementation = await deployer.deploy(BaseWallet);
    const registry = await deployer.deploy(Registry);
    lockStorage = await deployer.deploy(LockStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);
    transferStorage = await deployer.deploy(TransferStorage);

    // Deploy old architecture
    previousTransferManager = await deployer.deploy(LegacyTransferManager, {},
      registry.contractAddress,
      transferStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero);

    // Deploy new modules
    limitStorage = await deployer.deploy(LimitStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      ethers.constants.AddressZero,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      transferStorage.contractAddress,
      limitStorage.contractAddress);
    upgrader = await deployer.deploy(UpgraderToVersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      [previousTransferManager.contractAddress], // toDisable
      versionManager.contractAddress);
    await registry.registerModule(versionManager.contractAddress, ethers.utils.formatBytes32String("VersionManager"));
    await registry.registerModule(upgrader.contractAddress, ethers.utils.formatBytes32String("Upgrader"));

    // Deploy new features
    transferManager = await deployer.deploy(TransferManager, {},
      lockStorage.contractAddress,
      transferStorage.contractAddress,
      limitStorage.contractAddress,
      ethers.constants.AddressZero,
      versionManager.contractAddress,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero,
      previousTransferManager.contractAddress);
    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      limitStorage.contractAddress,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    manager.setRelayerManager(relayerManager);
    await versionManager.addVersion([transferManager.contractAddress, relayerManager.contractAddress], [transferManager.contractAddress]);
  });

  it("should fail to upgrade a pre-VersionManager wallet to a version lower than minVersion", async () => {
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner.address, [previousTransferManager.contractAddress]);
    const prevVersion = await versionManager.lastVersion();
    await versionManager.addVersion([], []);
    const lastVersion = await versionManager.lastVersion();
    await versionManager.setMinVersion(lastVersion);
    await assert.revertWith(
      previousTransferManager.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress),
      "VM: invalid _toVersion",
    );
    await versionManager.setMinVersion(prevVersion);
  });

  describe("After migrating a pre-VersionManager wallet", () => {
    beforeEach(async () => {
      const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
      wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

      await wallet.init(owner.address, [previousTransferManager.contractAddress]);
      await previousTransferManager.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress);
    });

    it("should add/remove an account to/from the whitelist", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
      await manager.increaseTime(SECURITY_PERIOD + 1);
      let isTrusted = await transferManager.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, true, "should be trusted after the security period");
      await transferManager.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);
      isTrusted = await transferManager.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, false, "should no removed from whitelist immediately");
    });

    it("should change the limit via relayed transaction", async () => {
      await manager.relay(transferManager, "changeLimit", [wallet.contractAddress, 4000000], wallet, [owner]);
      await manager.increaseTime(SECURITY_PERIOD + 1);
      const limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });
  });
});
