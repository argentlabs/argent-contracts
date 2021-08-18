/* global artifacts */

const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const ENSRegistry = artifacts.require("ENSRegistry");
const ArgentENSManager = artifacts.require("ArgentENSManager");
const ArgentENSResolver = artifacts.require("ArgentENSResolver");
const ReverseRegistrar = artifacts.require("ReverseRegistrar");
const Filter = artifacts.require("TestFilter");

const ARGENT_ENS_ADDRESS = "0xF32FDDEF964b98b1d2d2b1C071ac60ED55d4D217";
const ARGENT_ENS_OWNER_ADDRESS = "0xa5c603e1C27a96171487aea0649b01c56248d2e8";

const { ZERO_ADDRESS } = utils;

contract("ENS contracts", (accounts) => {
  let infrastructure;
  let owner;
  const amanager = accounts[3];
  const anonmanager = accounts[5];
  const recipient = accounts[8];

  let argent;
  const root = "xyz";
  const subnameWallet = "argent";
  const walletNode = ethers.utils.namehash(`${subnameWallet}.${root}`);
  const uniqueLabel = () => Math.random().toString().slice(2);

  let ensRegistry;
  let ensResolver;
  let ensReverse;
  let argentEnsManager;

  before(async () => {
    argent = await new ArgentContext(accounts).initialise();
    ({ infrastructure, owner } = argent);

    argentEnsManager = await ArgentENSManager.at(ARGENT_ENS_ADDRESS);
    await argentEnsManager.addManager(infrastructure, { from: ARGENT_ENS_OWNER_ADDRESS });

    ensRegistry = await ENSRegistry.at(await argentEnsManager.ensRegistry());
    ensResolver = await ArgentENSResolver.at(await argentEnsManager.ensResolver());
    ensReverse = await ReverseRegistrar.at(await argentEnsManager.getENSReverseRegistrar());

    const filter = await Filter.new();
    await argent.dappRegistry.addDapp(0, argentEnsManager.address, filter.address);
    await argent.dappRegistry.addDapp(0, recipient, ZERO_ADDRESS);
  });

  describe("ENS Manager", () => {
    it("should be the owner of the wallet root", async () => {
      const nodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(nodeOwner, argentEnsManager.address, "ens manager should be the owner of the wallet root node");
    });

    it("should return correct ENSResolver", async () => {
      const ensResolverOnManager = await argentEnsManager.ensResolver();
      assert.equal(ensResolverOnManager, ensResolver.address, "should have the correct ENSResolver addrress");
    });

    it("should return correct ENSReeverseRegistrar", async () => {
      const reverseRegistrar = await argentEnsManager.getENSReverseRegistrar();
      assert.equal(reverseRegistrar, ensReverse.address);
    });

    it("should register an ENS name", async () => {
      const label = uniqueLabel();
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await argentEnsManager.register(label, owner, "0x");

      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.address);
    });

    it("should not be able to register an ENS name twice", async () => {
      const label = uniqueLabel();
      await argentEnsManager.register(label, owner, "0x");

      await truffleAssert.reverts(argentEnsManager.register(label, owner, "0x"), "AEM: label is already owned");
    });

    it("should not be able to register an empty ENS label", async () => {
      const label = "";
      await truffleAssert.reverts(argentEnsManager.register(label, owner, "0x"), "AEM: ENS label must be defined");
    });

    it("should register wallet with reverse registrar when required", async () => {
      // Register with ENSReverse registrar first
      await ensReverse.claimWithResolver(argentEnsManager.address, ensResolver.address, { from: owner });

      const label = uniqueLabel();
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);

      const message = `0x${[
        owner,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(label)),
      ].map((hex) => hex.slice(2)).join("")}`;
      const managerSig = await utils.signMessage(ethers.utils.keccak256(message), infrastructure);

      const data = await argentEnsManager.contract.methods["register(string,address,bytes)"](label, owner, managerSig).encodeABI();
      await argentEnsManager.sendTransaction({ data, from: anonmanager });

      // check ens record
      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);
      const ensRecord = await ensResolver.addr(labelNode);
      assert.equal(ensRecord, owner);

      // check ens reverse record
      const reverseNode = await ensReverse.node(owner);
      const name = await ensResolver.name(reverseNode);
      assert.equal(name, `${label}.argent.xyz`);
    });

    it("should return the correct availability for a subnode", async () => {
      const label = uniqueLabel();
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      const labelNode1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
      // Node is initially available
      let available = await argentEnsManager.isAvailable(labelNode1);
      assert.isTrue(available);

      // then we register it
      await argentEnsManager.register(label, owner, "0x");

      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);

      // then the node is unavailable
      available = await argentEnsManager.isAvailable(labelNode1);
      assert.isFalse(available);
    });

    it("should add a new manager and register an ENS name", async () => {
      const label = uniqueLabel();
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await argentEnsManager.addManager(amanager, { from: ARGENT_ENS_OWNER_ADDRESS });
      const data = await argentEnsManager.contract.methods["register(string,address,bytes)"](label, owner, "0x").encodeABI();
      await argentEnsManager.sendTransaction({ data, from: amanager });

      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner, "new manager should have registered the ens name");
    });

    it("should fail to register an ENS name when the caller is not a manager", async () => {
      const label = uniqueLabel();
      const data = await argentEnsManager.contract.methods["register(string,address,bytes)"](label, owner, "0x").encodeABI();
      await truffleAssert.reverts(argentEnsManager.sendTransaction({ data, from: anonmanager }), "AEM: user is not manager");
    });

    it("should be able to change the root node owner", async () => {
      const randomAddress = await utils.getRandomAddress();
      await argentEnsManager.changeRootnodeOwner(randomAddress, { from: ARGENT_ENS_OWNER_ADDRESS });
      const rootNodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(rootNodeOwner, randomAddress);
    });

    it("should not be able to change the root node owner if not the owner", async () => {
      const randomAddress = await utils.getRandomAddress();
      await truffleAssert.reverts(argentEnsManager.changeRootnodeOwner(randomAddress, { from: amanager }), "Must be owner");
    });

    it("should be able to change the ens resolver", async () => {
      const randomAddress = await utils.getRandomAddress();
      await argentEnsManager.changeENSResolver(randomAddress, { from: ARGENT_ENS_OWNER_ADDRESS });
      const resolver = await argentEnsManager.ensResolver();
      assert.equal(resolver, randomAddress);
    });

    it("should not be able to change the ens resolver if not owner", async () => {
      const randomAddress = await utils.getRandomAddress();
      await truffleAssert.reverts(argentEnsManager.changeENSResolver(randomAddress, { from: amanager }), "Must be owner");
    });

    it("should not be able to change the ens resolver to an empty address", async () => {
      await truffleAssert.reverts(
        argentEnsManager.changeENSResolver(ethers.constants.AddressZero, { from: ARGENT_ENS_OWNER_ADDRESS }), "AEM: cannot set empty resolver");
    });
  });
});
