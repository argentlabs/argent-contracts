/* global accounts */
require("ethers");

const Registry = require("../build/ModuleRegistry");
const GuardianStorage = require("../build/GuardianStorage");
const VersionManager = require("../build/VersionManager");
const RelayerManager = require("../build/RelayerManager");
const LockStorage = require("../build/LockStorage");
const ERC20 = require("../build/TestERC20");
const NonCompliantERC20 = require("../build/NonCompliantERC20");

const TestManager = require("../utils/test-manager");

describe("BaseFeature", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;

  const owner = accounts[1].signer;

  let registry;
  let guardianStorage;
  let token;
  let relayerManager;

  before(async () => {
  });

  beforeEach(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    lockStorage = await deployer.deploy(LockStorage);
    const versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero);
    relayerManager = await deployer.deploy(RelayerManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    await versionManager.addVersion([relayerManager.contractAddress], []);

    token = await deployer.deploy(ERC20, {}, [owner.address], 10, 18);
  });

  describe("Recover tokens", async () => {
    it("should be able to recover ERC20 tokens sent to the feature", async () => {
      let balance = await token.balanceOf(relayerManager.contractAddress);
      assert.equal(balance, 0);

      await token.from(owner).transfer(relayerManager.contractAddress, 10000000);
      balance = await token.balanceOf(relayerManager.contractAddress);
      assert.equal(balance, 10000000);

      await relayerManager.recoverToken(token.contractAddress);

      balance = await token.balanceOf(relayerManager.contractAddress);
      assert.equal(balance, 0);

      const moduleregistryBalance = await token.balanceOf(registry.contractAddress);
      assert.equal(moduleregistryBalance, 10000000);
    });

    it("should be able to recover non-ERC20 compliant tokens sent to the feature", async () => {
      const nonCompliantToken = await deployer.deploy(NonCompliantERC20, {});
      await nonCompliantToken.mint(relayerManager.contractAddress, 10000000);
      let balance = await nonCompliantToken.balanceOf(relayerManager.contractAddress);
      assert.equal(balance, 10000000);

      await relayerManager.recoverToken(nonCompliantToken.contractAddress);

      balance = await nonCompliantToken.balanceOf(relayerManager.contractAddress);
      assert.equal(balance, 0);

      const moduleregistryBalance = await nonCompliantToken.balanceOf(registry.contractAddress);
      assert.equal(moduleregistryBalance, 10000000);
    });
  });
});
