const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const DAIPointsManager = require("../build/DAIPointsManager");
const TestDAI = require("../build/TestDAI");
const TestDAIPoints = require("../build/TestDAIPoints");

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt } = require("../utils/utilities.js");

describe("Test DAIPointsManager", function () {
  this.timeout(10000);

  const manager = new TestManager();

  let infrastructure = accounts[0].signer;
  let owner = accounts[1].signer;
  let dai, daiPoints, daiPointsModule, wallet, recipient;
  let amount = 100;

  before(async () => {
      deployer = manager.newDeployer();
      registry = await deployer.deploy(Registry);
  });

  beforeEach(async () => {
      dai = await deployer.deploy(TestDAI)
      daiPoints = await deployer.deploy(TestDAIPoints, {}, dai.contractAddress)
      daiPointsModule = await deployer.deploy(DAIPointsManager, {},
        registry.contractAddress,
        dai.contractAddress,
        daiPoints.contractAddress
      );
      await registry.registerModule(daiPointsModule.contractAddress, ethers.utils.formatBytes32String("DAIPointsManager"));

      wallet = await deployer.deploy(Wallet);
      await wallet.init(owner.address, [daiPointsModule.contractAddress]);
  });

  it("getDAIPoints", async () => {
    // no dai balance for wallet
    assert.equal((await dai.balanceOf(wallet.contractAddress)).toNumber(), 0, "wallet should have no dai balance");
    let txReceipt = await manager.relay(daiPointsModule, "getDAIPoints", [wallet.contractAddress, amount], wallet, [owner]);
    let success = parseRelayReceipt(txReceipt);
    assert.isNotOk(success, "should fail if no dai balance");

    // mint some dai to wallet and try again
    await dai.mint(wallet.contractAddress, amount);
    assert.equal((await dai.balanceOf(wallet.contractAddress)).toNumber(), amount, "wallet should have dai balance");
    txReceipt = await manager.relay(daiPointsModule, "getDAIPoints", [wallet.contractAddress, amount], wallet, [owner]);
    success = parseRelayReceipt(txReceipt);
    assert.isOk(success, "should be successful if there's dai balance");

    // check that all balances are correct
    assert.equal((await dai.balanceOf(wallet.contractAddress)).toNumber(), 0, "wallet should have no dai balance after success");
    assert.equal((await dai.balanceOf(daiPoints.contractAddress)).toNumber(), amount, "dai points should have dai balance after success");
    assert.equal((await daiPoints.balanceOf(wallet.contractAddress)).toNumber(), amount, "wallet should have dai points balance after success");
  });


  it("getDAIPointsToAddress", async () => {
    // create a recipient wallet
    recipient = await deployer.deploy(Wallet);
    await recipient.init(owner.address, [daiPointsModule.contractAddress]);

    // no dai balance for wallet
    assert.equal((await dai.balanceOf(wallet.contractAddress)).toNumber(), 0, "wallet should have no dai balance");
    let txReceipt = await manager.relay(daiPointsModule, "getDAIPointsToAddress", [wallet.contractAddress, amount, recipient.contractAddress], wallet, [owner]);
    let success = parseRelayReceipt(txReceipt);
    assert.isNotOk(success, "should fail if no dai balance");

    // mint some dai to wallet and try again
    await dai.mint(wallet.contractAddress, amount);
    assert.equal((await dai.balanceOf(wallet.contractAddress)).toNumber(), amount, "wallet should have dai balance");
    txReceipt = await manager.relay(daiPointsModule, "getDAIPointsToAddress", [wallet.contractAddress, amount, recipient.contractAddress], wallet, [owner]);
    success = parseRelayReceipt(txReceipt);
    assert.isOk(success, "should be successful if there's dai balance");

    // check that all balances are correct
    assert.equal((await dai.balanceOf(wallet.contractAddress)).toNumber(), 0, "wallet should have no dai balance after success");
    assert.equal((await dai.balanceOf(daiPoints.contractAddress)).toNumber(), amount, "dai points should have dai balance after success");
    assert.equal((await daiPoints.balanceOf(wallet.contractAddress)).toNumber(), 0, "wallet should have no dai points balance after success");
    assert.equal((await daiPoints.balanceOf(recipient.contractAddress)).toNumber(), amount, "recipient should have dai points balance after success");
  });
});