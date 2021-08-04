/* global artifacts */

const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const Vault = artifacts.require("yVaultV2Mock");
const YearnV2Filter = artifacts.require("YearnV2Filter");
const ERC20 = artifacts.require("TestERC20");

const amount = web3.utils.toWei("1");

contract("Yearn V2 Filter", (accounts) => {
  let argent;
  let wallet;
  let vault;
  let yvDai;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    vault = await Vault.at("0x19D3364A399d251E894aC732651be8B0E4e85001");
    yvDai = await ERC20.at(vault.address);

    const filter = await YearnV2Filter.new();
    await argent.dappRegistry.addDapp(0, vault.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ DAI: amount });
  });

  const deposit0 = async () => argent.multiCall(wallet, [
    [argent.DAI, "approve", [vault.address, amount]],
    [vault, "deposit", []]
  ]);

  const deposit1 = async () => argent.multiCall(wallet, [
    [argent.DAI, "approve", [vault.address, amount]],
    [vault, "deposit", [amount]]
  ]);

  it("should allow deposits (0 params)", async () => {
    const { success, error } = await utils.checkBalances(wallet, argent.DAI, yvDai, () => deposit0());
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow deposits (1 param)", async () => {
    const { success, error } = await utils.checkBalances(wallet, argent.DAI, yvDai, () => deposit1());
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow withdrawals (0 params)", async () => {
    await deposit0();

    const { success, error } = await utils.checkBalances(wallet, yvDai, argent.DAI, async () => ( 
      await argent.multiCall(wallet, [[vault, "withdraw", []]])
    ));

    assert.isTrue(success, `withdrawal failed: "${error}"`);
  });

  it("should allow withdrawals (1 param)", async () => {
    await deposit1();

    const { success, error } = await utils.checkBalances(wallet, yvDai, argent.DAI, async () => ( 
      await argent.multiCall(wallet, [[vault, "withdraw", [1]]])
    ));

    assert.isTrue(success, `withdrawal failed: "${error}"`);
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [[argent.DAI, "transfer", [vault.address, amount]]]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow calling unsupported method", async () => {
    const { success, error } = await argent.multiCall(wallet, [[vault, "setManagementFee", [1]]]);
    assert.isFalse(success, "setManagementFee() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH ", async () => {
    const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(vault.address, web3.utils.toWei("0.01"), "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
