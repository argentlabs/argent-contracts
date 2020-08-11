/* global artifacts */
const ethers = require("ethers");

const TestManager = require("../utils/test-manager");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const VersionManager = artifacts.require("VersionManager");
const Registry = artifacts.require("ModuleRegistry");

contract("Proxy", (accounts) => {
  const owner = accounts[1];

  let deployer;
  let walletImplementation;
  let wallet;
  let proxy;
  let module1;
  let module2;
  let module3;
  let registry;

  async function deployTestModule() {
    const module = await VersionManager.new(
      registry.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    await module.addVersion([], []);
    return module;
  }

  before(async () => {
    const manager = new TestManager();
    deployer = manager.newDeployer();
    registry = await Registry.new();
    walletImplementation = await BaseWallet.new();
    module1 = await deployTestModule();
    module2 = await deployTestModule();
    module3 = await deployTestModule();
  });

  beforeEach(async () => {
    proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
  });

  it("should init the wallet with the correct owner", async () => {
    let walletOwner = await wallet.owner();
    assert.equal(walletOwner, ethers.constants.AddressZero, "owner should be null before init");
    await wallet.init(owner, [module1.address]);
    walletOwner = await wallet.owner();
    assert.equal(walletOwner, owner, "owner should be the owner after init");
  });

  it("should init a wallet with the correct modules", async () => {
    await wallet.init(owner, [module1.address, module2.address]);
    const module1IsAuthorised = await wallet.authorised(module1.address);
    const module2IsAuthorised = await wallet.authorised(module2.address);
    const module3IsAuthorised = await wallet.authorised(module3.address);
    assert.equal(module1IsAuthorised, true, "module1 should be authorised");
    assert.equal(module2IsAuthorised, true, "module2 should be authorised");
    assert.equal(module3IsAuthorised, false, "module3 should not be authorised");
  });

  it("should accept ETH", async () => {
    const before = await deployer.provider.getBalance(wallet.address);
    await wallet.send(50000000);
    const after = await deployer.provider.getBalance(wallet.address);
    assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
  });
});
