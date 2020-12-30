/* global artifacts */
const { getBalance } = require("../utils/utilities.js");

const DelegateProxy = artifacts.require("DelegateProxy");

contract("DelegateProxy", (accounts) => {
  const owner = accounts[1];
  let wallet;

  beforeEach(async () => {
    wallet = await DelegateProxy.new({ from: owner });
  });

  it("should init the wallet with the correct owner", async () => {
    const walletOwner = await wallet.owner();
    assert.equal(walletOwner, owner);
  });

  it("should accept ETH", async () => {
    const before = await getBalance(wallet.address);
    await wallet.send(5);
    const after = await getBalance(wallet.address);
    assert.equal(after.sub(before).toNumber(), 5);
  });
});
