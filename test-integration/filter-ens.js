/* global artifacts */

const ethers = require("ethers");
const utils = require("../utils/utilities.js");
const { deployArgent } = require("../utils/argent-deployer.js");

const ENSRegistry = artifacts.require("ENSRegistry");
const ArgentENSManager = artifacts.require("ArgentENSManager");
const ArgentENSResolver = artifacts.require("ArgentENSResolver");
const ArgentEnsManagerFilter = artifacts.require("ArgentEnsManagerFilter");

const ARGENT_ENS_ADDRESS = "0xF32FDDEF964b98b1d2d2b1C071ac60ED55d4D217";
const ARGENT_ENS_OWNER_ADDRESS = "0xa5c603e1C27a96171487aea0649b01c56248d2e8";

contract("ENS Filter", (accounts) => {
  let argent;
  let ensRegistry;
  let ensResolver;
  let argentEnsManager;

  before(async () => {
    argent = await deployArgent(accounts);

    argentEnsManager = await ArgentENSManager.at(ARGENT_ENS_ADDRESS);
    await argentEnsManager.addManager(argent.infrastructure, { from: ARGENT_ENS_OWNER_ADDRESS });

    ensRegistry = await ENSRegistry.at(await argentEnsManager.ensRegistry());
    ensResolver = await ArgentENSResolver.at(await argentEnsManager.ensResolver());

    const filter = await ArgentEnsManagerFilter.new();
    await argent.dappRegistry.addDapp(0, argentEnsManager.address, filter.address);
  });

  it("should register an ENS name", async () => {
    const label = Math.random().toString().slice(2);
    const labelNode = ethers.utils.namehash(`${label}.argent.xyz`);
    await argentEnsManager.register(label, argent.owner, "0x");

    const recordExists = await ensRegistry.recordExists(labelNode);
    assert.isTrue(recordExists);
    const nodeOwner = await ensRegistry.owner(labelNode);
    assert.equal(nodeOwner, argent.owner);
    const result = await ensRegistry.resolver(labelNode);
    assert.equal(result, ensResolver.address);
  });

  it("should not allow sending ETH ", async () => {
    const wallet = await argent.createFundedWallet();
    const transaction = utils.encodeTransaction(argentEnsManager.address, web3.utils.toWei("0.01"), "0x");
    const { success, error } = await argent.multiCall(wallet, [transaction]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
