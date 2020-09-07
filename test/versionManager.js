/* global accounts */
const ethers = require("ethers");
const GuardianManager = require("../build/GuardianManager");
const LockStorage = require("../build/LockStorage");
const GuardianStorage = require("../build/GuardianStorage");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const RelayerManager = require("../build/RelayerManager");
const VersionManager = require("../build/VersionManager");
const Registry = require("../build/ModuleRegistry");

const TestManager = require("../utils/test-manager");

describe("VersionManager", function () {
  this.timeout(100000);

  const manager = new TestManager(accounts);

  const owner = accounts[1].signer;

  let deployer;
  let wallet;
  let walletImplementation;
  let lockStorage;
  let guardianStorage;
  let guardianManager;
  let relayerManager;
  let versionManager;

  before(async () => {
    deployer = manager.newDeployer();
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    const registry = await deployer.deploy(Registry);
    lockStorage = await deployer.deploy(LockStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    guardianManager = await deployer.deploy(GuardianManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      versionManager.contractAddress,
      24,
      12);
    await versionManager.addVersion([guardianManager.contractAddress, relayerManager.contractAddress], []);
    manager.setRelayerManager(relayerManager);

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner.address, [versionManager.contractAddress]);
  });

  describe("VersionManager owner", () => {
    it("should not let the VersionManager owner add a storage twice", async () => {
      await assert.revertWith(versionManager.addStorage(lockStorage.contractAddress), "VM: Storage already added");
    });

    it("should not let the VersionManager owner add an inconsistent version", async () => {
      // Should fail: the _featuresToInit array includes a feature not listed in the _features array
      await assert.revertWith(
        versionManager.addVersion([relayerManager.contractAddress], [guardianManager.contractAddress]),
        "VM: Invalid _featuresToInit",
      );
    });
  });

  describe("Wallet owner", () => {
    it("should not let the relayer call a forbidden method", async () => {
      await assert.revertWith(
        manager.relay(versionManager, "setOwner", [wallet.contractAddress, owner.address], wallet, [owner]),
        "VM: unknown method",
      );
    });

    it("should fail to upgrade a wallet when already on the last version", async () => {
      await assert.revertWith(
        versionManager.from(owner).upgradeWallet(wallet.contractAddress),
        "VM: Already on last version",
      );
    });
  });
});
