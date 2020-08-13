/* global artifacts */
const ethers = require("ethers");

const ENSRegistry = artifacts.require("ENSRegistry");
const ENSRegistryWithFallback = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");

const utilities = require("../utils/utilities.js");

const ZERO_BYTES32 = ethers.constants.HashZero;

contract("ENS contracts", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const amanager = accounts[2];
  const anonmanager = accounts[3];

  const root = "xyz";
  const subnameWallet = "argent";
  const walletNode = ethers.utils.namehash(`${subnameWallet}.${root}`);

  let ensRegistry;
  let ensResolver;
  let ensReverse;
  let ensManager;

  beforeEach(async () => {
    const ensRegistryWithoutFallback = await ENSRegistry.new();
    ensRegistry = await ENSRegistryWithFallback.new(ensRegistryWithoutFallback.address);
    ensResolver = await ENSResolver.new();
    ensReverse = await ENSReverseRegistrar.new(ensRegistry.address, ensResolver.address);
    ensManager = await ENSManager.new(`${subnameWallet}.${root}`, walletNode, ensRegistry.address, ensResolver.address);
    await ensResolver.addManager(ensManager.address);
    await ensResolver.addManager(infrastructure);
    await ensManager.addManager(infrastructure);

    await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(root)), infrastructure);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash(root), ethers.utils.keccak256(ethers.utils.toUtf8Bytes(subnameWallet)), ensManager.address,
    );
    await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes("reverse")), infrastructure);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash("reverse"), ethers.utils.keccak256(ethers.utils.toUtf8Bytes("addr")), ensReverse.address,
    );
  });

  describe("ENS Manager", () => {
    it("should be the owner of the wallet root", async () => {
      const nodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(nodeOwner, ensManager.address, "ens manager should be the owner of the wallet root node");
    });

    it("should return correct ENSResolver", async () => {
      const ensResolverOnManager = await ensManager.ensResolver();
      assert.equal(ensResolverOnManager, ensResolver.address, "should have the correct ENSResolver addrress");
    });

    it("should register an ENS name", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await ensManager.from(infrastructure).register(label, owner);

      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.address);
    });

    it("should return the correct availability for a subnode", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      const labelNode1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
      // Node is initially available
      let available = await ensManager.isAvailable(labelNode1);
      assert.isTrue(available);

      // then we register it
      await ensManager.from(infrastructure).register(label, owner);

      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);

      // then the node is unavailable
      available = await ensManager.isAvailable(labelNode1);
      assert.isFalse(available);
    });

    it("should add a new manager and register an ENS name", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await ensManager.addManager(amanager);
      await ensManager.from(amanager).register(label, owner);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner, "new manager should have registered the ens name");
    });

    it("should fail to register an ENS name when the caller is not a manager", async () => {
      const label = "wallet";
      await assert.revert(ensManager.from(anonmanager).register(label, owner), "registering should throw");
    });

    it("should be able to change the root node owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await ensManager.changeRootnodeOwner(randomAddress);
      const rootNodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(rootNodeOwner, randomAddress);
    });

    it("should not be able to change the root node owner if not the owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await assert.revertWith(ensManager.from(amanager).changeRootnodeOwner(randomAddress), "Must be owner");
    });

    it("should be able to change the ens resolver", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await ensManager.changeENSResolver(randomAddress);
      const resolver = await ensManager.ensResolver();
      assert.equal(resolver, randomAddress);
    });

    it("should not be able to change the ens resolver if not owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await assert.revertWith(ensManager.from(amanager).changeENSResolver(randomAddress), "Must be owner");
    });

    it("should not be able to change the ens resolver to an empty address", async () => {
      await assert.revertWith(ensManager.changeENSResolver(ethers.constants.AddressZero), "WF: address cannot be null");
    });
  });

  describe("ENS Resolver", () => {
    it("should return correct ENS interface support responses", async () => {
      const SUPPORT_INTERFACE_ID = "0x01ffc9a7"; // EIP 165
      const ADDR_INTERFACE_ID = "0x3b3b57de"; // EIP 137
      const NAME_INTERFACE_ID = "0x691f3431"; // EIP 181

      let support = await ensResolver.supportsInterface(SUPPORT_INTERFACE_ID);
      assert.isTrue(support);
      support = await ensResolver.supportsInterface(ADDR_INTERFACE_ID);
      assert.isTrue(support);
      support = await ensResolver.supportsInterface(NAME_INTERFACE_ID);
      assert.isTrue(support);
    });

    it("should return 0 address for a non-existent record", async () => {
      const labelNode = ethers.utils.namehash(`${"missingnode"}.${subnameWallet}.${root}`);
      const nonExistentRecord = await ensResolver.addr(labelNode);
      assert.equal(nonExistentRecord, ethers.constants.AddressZero);
    });

    it("should resolve a name", async () => {
      const label = "wallet";
      await ensManager.from(infrastructure).register(label, owner);

      const node = await ensReverse.node(owner);
      const name = await ensResolver.name(node);
      assert.equal(name, "wallet.argent.xyz");
    });
  });
});
