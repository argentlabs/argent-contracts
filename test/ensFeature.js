/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const ENSRegistry = artifacts.require("ENSRegistry");
const ENSRegistryWithFallback = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const VersionManager = artifacts.require("VersionManager");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const EnsFeature = artifacts.require("EnsFeature");

contract("EnsFeature", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];

  let ensRegistry;
  let ensReverse;
  let ensResolver;
  let ensManager;
  let walletImplementation;
  let moduleRegistry;
  let lockStorage;
  let guardianStorage;
  let versionManager;
  let ensFeature;
  let wallet;

  const root = "xyz";
  const subnameWallet = "argent";
  const walletNode = ethers.utils.namehash(`${subnameWallet}.${root}`);

  before(async () => {
    walletImplementation = await BaseWallet.new();
    moduleRegistry = await ModuleRegistry.new();
    lockStorage = await LockStorage.new();
    guardianStorage = await GuardianStorage.new();
  });

  beforeEach(async () => {
    const ensRegistryWithoutFallback = await ENSRegistry.new();
    ensRegistry = await ENSRegistryWithFallback.new(ensRegistryWithoutFallback.address);
    ensResolver = await ENSResolver.new();
    ensReverse = await ENSReverseRegistrar.new(ensRegistry.address, ensResolver.address);
    ensManager = await ENSManager.new(`${subnameWallet}.${root}`, walletNode, ensRegistry.address, ensResolver.address);
    await ensResolver.addManager(ensManager.address);
    await ensResolver.addManager(infrastructure);
    await ensManager.addManager(infrastructure);

    await ensRegistry.setSubnodeOwner(ethers.constants.HashZero, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(root)), infrastructure);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash(root), ethers.utils.keccak256(ethers.utils.toUtf8Bytes(subnameWallet)), ensManager.address,
    );
    await ensRegistry.setSubnodeOwner(ethers.constants.HashZero, ethers.utils.keccak256(ethers.utils.toUtf8Bytes("reverse")), infrastructure);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash("reverse"), ethers.utils.keccak256(ethers.utils.toUtf8Bytes("addr")), ensReverse.address,
    );

    versionManager = await VersionManager.new(
      moduleRegistry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    ensFeature = await EnsFeature.new(lockStorage.address, versionManager.address, ensManager.address);
    await ensManager.addManager(ensFeature.address);

    await versionManager.addVersion([ensFeature.address], []);
    await moduleRegistry.registerModule(versionManager.address, ethers.utils.formatBytes32String("versionManager"));

    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
  });

  describe("Ens subname registration", () => {
    it("should allow the wallet owner to register an ENS name", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await ensFeature.registerWalletENS(wallet.address, label, { from: owner });

      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, wallet.address);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.address);
    });

    it("should fail to register with empty label", async () => {
      const label = "";
      await truffleAssert.reverts(ensFeature.registerWalletENS(wallet.address, label, { from: owner }),
        "EF: ENS label must be defined");
    });

    it("should fail to register by a non owner", async () => {
      const label = "wallet";
      await truffleAssert.reverts(ensFeature.registerWalletENS(wallet.address, label),
        "BF: must be owner or feature");
    });
  });
});
