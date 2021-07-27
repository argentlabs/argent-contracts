/* global artifacts */

const ArgentContext = require("../utils/argent-context.js");

const Vault = artifacts.require("yVaultV2Mock");
const YearnV2Filter = artifacts.require("YearnV2Filter");

const amount = web3.utils.toWei("1");

contract("Yearn V2 Filter", (accounts) => {
  let argent, wallet;
  let vault;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    vault = await Vault.at("0x19D3364A399d251E894aC732651be8B0E4e85001");

    const filter = await YearnV2Filter.new();
    await argent.dappRegistry.addDapp(0, vault.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ DAI: "1" });
  });

  const deposit = async () => argent.multiCall(wallet, [
    [argent.DAI, "approve", [vault.address, amount]],
    [vault, "deposit", []]
  ]);

  it("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow withdrawals", async () => {
    await deposit();
    const { success, error } = await argent.multiCall(wallet, [
      [vault, "withdraw", []]
    ]);
    assert.isTrue(success, `withdrawal failed: "${error}"`);
  });
});
