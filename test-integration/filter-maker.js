/* global artifacts */

const BN = require("bn.js");
const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");
const { WAD } = require("../utils/defi-deployer");

const PotFilter = artifacts.require("PotFilter");
const VatFilter = artifacts.require("VatFilter");
const DaiJoinFilter = artifacts.require("DaiJoinFilter");
const DaiJoin = artifacts.require("DaiJoin");
const Vat = artifacts.require("Vat");
const Pot = artifacts.require("Pot");

const DAI_SENT = WAD.div(new BN(100000000)).toString();

contract("Maker DSR Filter", (accounts) => {
  let argent;
  let wallet;

  let dai;
  let daiJoin;
  let vat;
  let pot;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    dai = argent.DAI;
    daiJoin = await DaiJoin.at("0x9759A6Ac90977b93B58547b4A71c78317f391A28");
    vat = await Vat.at("0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B");
    pot = await Pot.at("0x197e90f9fad81970ba7976f33cbd77088e5d7cf7");

    await argent.dappRegistry.addDapp(0, pot.address, (await PotFilter.new()).address);
    await argent.dappRegistry.addDapp(0, daiJoin.address, (await DaiJoinFilter.new()).address);
    await argent.dappRegistry.addDapp(0, vat.address, (await VatFilter.new(daiJoin.address, pot.address)).address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ DAI: web3.utils.toWei("1")});
  });

  const deposit = async () => argent.multiCall(wallet, [
    [pot, "drip"],
    [dai, "approve", [daiJoin.address, DAI_SENT]],
    [daiJoin, "join", [wallet.address, DAI_SENT]],
    [vat, "hope", [pot.address]],
    [pot, "join", [DAI_SENT]],
  ]);

  const withdraw = async () => argent.multiCall(wallet, [
    [pot, "drip"],
    [pot, "exit", [DAI_SENT]],
    [vat, "hope", [daiJoin.address]],
    [daiJoin, "exit", [wallet.address, DAI_SENT]],
  ]);

  it.skip("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it.skip("should allow withdrawals", async () => {
    await deposit();
    const { success, error } = await withdraw({ all: false });
    assert.isTrue(success, `withdraw failed: "${error}"`);
  });

  it("should not allow direct transfers to pot, vat or daiJoin", async () => {
    for (const to of [pot.address, vat.address, daiJoin.address]) {
      const { success, error } = await argent.multiCall(wallet, [
        [dai, "transfer", [to, DAI_SENT]]
      ]);
      assert.isFalse(success, "transfer should have failed");
      assert.equal(error, "TM: call not authorised");
    }
  });

  it("should not allow unsupported method call to pot, vat or daiJoin", async () => {
    for (const [to, method] of [[pot, "cage"], [vat, "vice"], [daiJoin, "live"]]) {
      const { success, error } = await argent.multiCall(wallet, [[to, method]]);
      assert.isFalse(success, `${method}() should have failed`);
      assert.equal(error, "TM: call not authorised");
    }
  });

  it("should not allow sending ETH to pot, vat or daiJoin", async () => {
    for (const to of [pot.address, vat.address, daiJoin.address]) {
      const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(to, web3.utils.toWei("0.01"), "0x")]);
      assert.isFalse(success, "sending ETH should have failed");
      assert.equal(error, "TM: call not authorised");
    }
  });
});
