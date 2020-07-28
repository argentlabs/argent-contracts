/* global artifacts */
const ethers = require("ethers");

const TestManager = require("../utils/test-manager");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const VersionManager = artifacts.require("VersionManager");
const Registry = artifacts.require("ModuleRegistry");

contract("Proxy", function (accounts) {
  this.timeout(10000);

  const owner = accounts[1].signer;
  const nonowner = accounts[2].signer;

  let deployer;
  let walletImplementation;
  let wallet;
  let proxy;
  let module1;
  let module2;
  let module3;
  let registry;

  async function deployTestModule() {
    const module = await deployer.deploy(VersionManager, {},
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
    registry = await deployer.deploy(Registry);
    walletImplementation = await deployer.deploy(BaseWallet);
    module1 = await deployTestModule();
    module2 = await deployTestModule();
    module3 = await deployTestModule();
  });

  beforeEach(async () => {
    proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
  });

  it("should init the wallet with the correct owner", async () => {
    let walletOwner = await wallet.owner();
    assert.equal(walletOwner, ethers.constants.AddressZero, "owner should be null before init");
    await wallet.init(owner.address, [module1.contractAddress]);
    walletOwner = await wallet.owner();
    assert.equal(walletOwner, owner.address, "owner should be the owner after init");
  });

  it("should init a wallet with the correct modules", async () => {
    await wallet.init(owner.address, [module1.contractAddress, module2.contractAddress]);
    const module1IsAuthorised = await wallet.authorised(module1.contractAddress);
    const module2IsAuthorised = await wallet.authorised(module2.contractAddress);
    const module3IsAuthorised = await wallet.authorised(module3.contractAddress);
    assert.equal(module1IsAuthorised, true, "module1 should be authorised");
    assert.equal(module2IsAuthorised, true, "module2 should be authorised");
    assert.equal(module3IsAuthorised, false, "module3 should not be authorised");
  });

  it("should accept ETH", async () => {
    const before = await deployer.provider.getBalance(wallet.contractAddress);
    await nonowner.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
    const after = await deployer.provider.getBalance(wallet.contractAddress);
    assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
  });
});
