/* global artifacts */
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));
const { ETH_TOKEN, getBalance } = require("../utils/utilities.js");

const DelegateProxy = artifacts.require("DelegateProxy");
const Registry = artifacts.require("Registry");
const ApprovedTransfer = artifacts.require("ApprovedTransfer");

contract("ApprovedTrasfer", (accounts) => {
  const owner = accounts[1];
  const userA = accounts[2];
  let wallet;
  let registry;

  beforeEach(async () => {
    const proxy = await DelegateProxy.new({ from: owner });
    registry = await Registry.new({ from: owner });
    await proxy.setRegistry(registry.address, { from: owner });

    const approvedTransfer = await ApprovedTransfer.new();
    await registry.register("transferToken(address,address,uint256)", approvedTransfer.address, { from: owner });

    wallet = await ApprovedTransfer.at(proxy.address);
  });

  it("should allow owner to transfer ETH", async () => {
    wallet.send(5);
    const balanceBefore = await getBalance(userA);
    await wallet.transferToken(ETH_TOKEN, userA, 5);
    const balanceAfter = await getBalance(userA);
    expect(balanceBefore.addn(5)).to.be.eq.BN(balanceAfter);
  });
});
