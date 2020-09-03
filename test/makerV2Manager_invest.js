const ethers = require("ethers");
const {
  deployMaker, deployUniswap, WAD, ETH_PER_DAI, ETH_PER_MKR,
} = require("../utils/defi-deployer");
const TestManager = require("../utils/test-manager");
const Registry = require("../build/ModuleRegistry");
const MakerV2Manager = require("../build/MakerV2Manager");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const GuardianStorage = require("../build/GuardianStorage");
const LockStorage = require("../build/LockStorage");
const MakerRegistry = require("../build/MakerRegistry");
const RelayerManager = require("../build/RelayerManager");
const VersionManager = require("../build/VersionManager");

const DAI_SENT = WAD.div(100000000);

/* global accounts */
describe("MakerV2 DSR", function () {
  this.timeout(100000);

  const manager = new TestManager();
  const { deployer } = manager;

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;

  let wallet;
  let walletImplementation;
  let relayerManager;
  let versionManager;
  let makerV2;
  let sai;
  let dai;

  before(async () => {
    const m = await deployMaker(deployer, infrastructure);
    [sai, dai] = [m.sai, m.dai];
    const {
      migration,
      pot,
      jug,
      vat,
      gov,
    } = m;

    const registry = await deployer.deploy(Registry);
    const guardianStorage = await deployer.deploy(GuardianStorage);
    const lockStorage = await deployer.deploy(LockStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero);

    const makerRegistry = await deployer.deploy(MakerRegistry, {}, vat.contractAddress);

    // Deploy Uniswap
    const uni = await deployUniswap(deployer, manager, infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);

    makerV2 = await deployer.deploy(
      MakerV2Manager,
      {},
      lockStorage.contractAddress,
      migration.contractAddress,
      pot.contractAddress,
      jug.contractAddress,
      makerRegistry.contractAddress,
      uni.uniswapFactory.contractAddress,
      versionManager.contractAddress,
    );

    walletImplementation = await deployer.deploy(BaseWallet);

    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([makerV2.contractAddress, relayerManager.contractAddress], []);
  });

  beforeEach(async () => {
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

    await wallet.init(owner.address, [versionManager.contractAddress]);
    await sai["mint(address,uint256)"](wallet.contractAddress, DAI_SENT.mul(20));
    await dai["mint(address,uint256)"](wallet.contractAddress, DAI_SENT.mul(20));
  });

  async function exchangeWithPot({ toPot, relayed, all = false }) {
    const walletBefore = (await dai.balanceOf(wallet.contractAddress)).add(await sai.balanceOf(wallet.contractAddress));
    const investedBefore = await makerV2.dsrBalance(wallet.contractAddress);
    let method;
    if (toPot) {
      method = "joinDsr";
    } else if (all) {
      method = "exitAllDsr";
    } else {
      method = "exitDsr";
    }
    const params = [wallet.contractAddress].concat(all ? [] : [DAI_SENT]);
    if (relayed) {
      await manager.relay(makerV2, method, params, wallet, [owner]);
    } else {
      await (await makerV2.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
    }
    const walletAfter = (await dai.balanceOf(wallet.contractAddress)).add(await sai.balanceOf(wallet.contractAddress));
    const investedAfter = await makerV2.dsrBalance(wallet.contractAddress);
    const deltaInvested = toPot ? investedAfter.sub(investedBefore) : investedBefore.sub(investedAfter);
    const deltaWallet = toPot ? walletBefore.sub(walletAfter) : walletAfter.sub(walletBefore);
    assert.isTrue(deltaInvested.gt(0), "DAI in DSR should have changed.");
    assert.isTrue(deltaWallet.gt(0), "DAI in wallet should have changed.");

    if (all) {
      assert.isTrue(investedAfter.eq(0), "Pot should be emptied");
      assert.isTrue(walletAfter.gt(walletBefore), "DAI in wallet should have increased");
    }
  }

  describe("Deposit", () => {
    it("sends DAI to the pot (blockchain tx)", async () => {
      await exchangeWithPot({ toPot: true, relayed: false });
      // do it a second time, when Vat authorisations have already been granted
      await exchangeWithPot({ toPot: true, relayed: false });
    });

    it("sends DAI to the pot (relayed tx)", async () => {
      await exchangeWithPot({ toPot: true, relayed: true });
      // do it a second time, when Vat authorisations have already been granted
      await exchangeWithPot({ toPot: true, relayed: true });
    });
  });

  describe("Withdraw", () => {
    beforeEach(async () => {
      await exchangeWithPot({ toPot: true, relayed: false });
    });

    it("withdraw DAI from the pot (blockchain tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: false });
    });

    it("withdraw DAI from the pot (relayed tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: true });
    });

    it("withdraw ALL DAI from the pot (blockchain tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: false, all: true });
    });

    it("withdraw ALL DAI from the pot (relayed tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: true, all: true });
    });
  });
});
