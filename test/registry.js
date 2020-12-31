/* global artifacts */
const { assert } = require("chai");
const ethers = require("ethers");
const { getRandomAddress } = require("../utils/utilities.js");

const Registry = artifacts.require("Registry");

contract("Registry", (accounts) => {
  const owner = accounts[1];
  let registry;

  beforeEach(async () => {
    registry = await Registry.new({ from: owner });
  });

  it("should init the registry with the correct owner", async () => {
    const registryOwner = await registry.owner();
    assert.equal(registryOwner, owner);
  });

  it("should be able to register a function signature's implementation", async () => {
    const impl = getRandomAddress();
    await registry.register("someFunction(address,uint256)", impl, { from: owner });

    const sig = await registry.stringToSig("someFunction(address,uint256)");
    const sigImpl = await registry.pointers(sig);
    assert.equal(sigImpl, impl);
  });

  it("should return the implementation for a function overload", async () => {
    const implA = getRandomAddress();
    const implB = getRandomAddress();
    await registry.register("someFunction(address)", implA, { from: owner });
    await registry.register("someFunction(address,uint256)", implB, { from: owner });

    const sigA = await registry.stringToSig("someFunction(address)");
    const sigB = await registry.stringToSig("someFunction(address,uint256)");
    const sigImplA = await registry.lookup(sigA);
    assert.equal(sigImplA, implA);
    const sigImplB = await registry.lookup(sigB);
    assert.equal(sigImplB, implB);
  });

  it("should return 0 for non-registrered implementations", async () => {
    const implementation = await registry.lookup("0xdeadbeef");
    assert.equal(implementation, ethers.constants.AddressZero);
  });

  it("should return correctly encoded function signature", async () => {
    const signature = await registry.stringToSig("someFunction(address)");
    assert.equal(signature, "0x1691d2bd");
  });
});
