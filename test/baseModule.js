/* global artifacts */
const ethers = require("ethers");

const Registry = artifacts.require("ModuleRegistry");
const GuardianStorage = artifacts.require("GuardianStorage");
const VersionManager = artifacts.require("VersionManager");
const RelayerManager = artifacts.require("RelayerManager");
const LockStorage = artifacts.require("LockStorage");
const ERC20 = artifacts.require("TestERC20");
const NonCompliantERC20 = artifacts.require("NonCompliantERC20");

contract("BaseModule", (accounts) => {
  const owner = accounts[1];

  let registry;
  let versionManager;
  let guardianStorage;
  let lockStorage;
  let token;
  let relayerManager;

  before(async () => {
  });

  beforeEach(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    lockStorage = await LockStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    await versionManager.addVersion([relayerManager.address], []);

    token = await ERC20.new([owner], 10, 18);
  });

  describe("Recover tokens", async () => {
    it("should be able to recover ERC20 tokens sent to the feature", async () => {
      let balance = await token.balanceOf(relayerManager.address);
      assert.equal(balance, 0);

      await token.transfer(relayerManager.address, 10000000, { from: owner });
      balance = await token.balanceOf(relayerManager.address);
      assert.equal(balance, 10000000);

      await relayerManager.recoverToken(token.address);

      balance = await token.balanceOf(relayerManager.address);
      assert.equal(balance, 0);

      const versionManagerBalance = await token.balanceOf(versionManager.address);
      assert.equal(versionManagerBalance, 10000000);

      await versionManager.recoverToken(token.address);

      const adminBalance = await token.balanceOf(accounts[0]);
      assert.equal(adminBalance, 10000000);
    });

    it("should be able to recover non-ERC20 compliant tokens sent to the feature", async () => {
      const nonCompliantToken = await NonCompliantERC20.new();
      await nonCompliantToken.mint(relayerManager.address, 10000000);
      let balance = await nonCompliantToken.balanceOf(relayerManager.address);
      assert.equal(balance, 10000000);

      await relayerManager.recoverToken(nonCompliantToken.address);

      balance = await nonCompliantToken.balanceOf(relayerManager.address);
      assert.equal(balance, 0);

      const versionManagerBalance = await nonCompliantToken.balanceOf(versionManager.address);
      assert.equal(versionManagerBalance, 10000000);

      await versionManager.recoverToken(nonCompliantToken.address);

      const adminBalance = await nonCompliantToken.balanceOf(accounts[0]);
      assert.equal(adminBalance, 10000000);
    });
  });
});
