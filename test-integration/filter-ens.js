/* global artifacts */

const ethers = require("ethers");
const utils = require("../utils/utilities.js");
const { deployArgent } = require("../utils/argent-deployer.js");

const ENSRegistry = artifacts.require("ENSRegistry");
const ArgentENSManager = artifacts.require("ArgentENSManager");
const ArgentENSResolver = artifacts.require("ArgentENSResolver");
const ArgentEnsManagerFilter = artifacts.require("ArgentEnsManagerFilter");

contract("ENS Filter", (accounts) => {
  let argent;
  let wallet;

  let ensManager;
  let ensRegistry;
  let ensResolver;

  before(async () => {
    argent = await deployArgent(accounts);

    ensManager = await ArgentENSManager.at("0xF32FDDEF964b98b1d2d2b1C071ac60ED55d4D217");
    ensRegistry = await ENSRegistry.at(await ensManager.ensRegistry());
    ensResolver = await ArgentENSResolver.at(await ensManager.ensResolver());

    const ensManagerOwner = await ensManager.owner();
    await ensManager.addManager(argent.infrastructure, { from: ensManagerOwner });
    await ensResolver.addManager(argent.infrastructure, { from: ensManagerOwner });

    const filter = await ArgentEnsManagerFilter.new();
    await argent.dappRegistry.addDapp(0, ensManager.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  it("should register an ENS name", async () => {
    const label = Math.random().toString().slice(2);
    const hexLabel = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(label));
    const message = `0x${[wallet.address, hexLabel].map((hex) => hex.slice(2)).join("")}`;
    const managerSig = await utils.signMessage(ethers.utils.keccak256(message), argent.infrastructure);

    const { success, error } = await argent.multiCall(wallet, [
      [ensManager, "register", [label, wallet.address, managerSig]]
    ]);
    assert.isTrue(success, `call failed: ${error}`);

    const fullName = `${label}.argent.xyz`;
    const labelNode = ethers.utils.namehash(fullName);
    const recordExists = await ensRegistry.recordExists(labelNode);
    assert.isTrue(recordExists);
    const nodeOwner = await ensRegistry.owner(labelNode);
    assert.equal(nodeOwner, wallet.address);
    const result = await ensRegistry.resolver(labelNode);
    assert.equal(result, ensResolver.address);
  });

  it("should not allow sending ETH ", async () => {
    const transaction = utils.encodeTransaction(ensManager.address, web3.utils.toWei("0.01"), "0x");
    const { success, error } = await argent.multiCall(wallet, [transaction]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
