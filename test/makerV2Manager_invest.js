/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const { deployMaker, deployUniswap, WAD, ETH_PER_DAI, ETH_PER_MKR } = require("../utils/defi-deployer");
const RelayManager = require("../utils/relay-manager");

const Registry = artifacts.require("ModuleRegistry");
const MakerV2Manager = artifacts.require("MakerV2Manager");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const GuardianStorage = artifacts.require("GuardianStorage");
const LockStorage = artifacts.require("LockStorage");
const MakerRegistry = artifacts.require("MakerRegistry");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");

contract("MakerV2Invest", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const DAI_SENT = WAD.div(new BN(100000000));

  let wallet;
  let walletImplementation;
  let relayerManager;
  let versionManager;
  let makerV2;
  let sai;
  let dai;

  before(async () => {
    const m = await deployMaker(infrastructure);
    [sai, dai] = [m.sai, m.dai];
    const {
      migration,
      pot,
      jug,
      vat,
      gov,
    } = m;

    const registry = await Registry.new();
    const guardianStorage = await GuardianStorage.new();
    const lockStorage = await LockStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    const makerRegistry = await MakerRegistry.new(vat.address);

    // Deploy Uniswap
    const uni = await deployUniswap(infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);

    makerV2 = await MakerV2Manager.new(
      lockStorage.address,
      migration.address,
      pot.address,
      jug.address,
      makerRegistry.address,
      uni.uniswapFactory.address,
      versionManager.address,
    );

    walletImplementation = await BaseWallet.new();

    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    await manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([makerV2.address, relayerManager.address], []);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);

    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
    await sai.mint(wallet.address, DAI_SENT.muln(20));
    await dai.mint(wallet.address, DAI_SENT.muln(20));
  });

  async function exchangeWithPot({ toPot, relayed, all = false }) {
    const walletBefore = (await dai.balanceOf(wallet.address)).add(await sai.balanceOf(wallet.address));
    const investedBefore = await makerV2.dsrBalance(wallet.address);
    let method;
    if (toPot) {
      method = "joinDsr";
    } else if (all) {
      method = "exitAllDsr";
    } else {
      method = "exitDsr";
    }
    const params = [wallet.address].concat(all ? [] : [DAI_SENT.toString()]);

    if (relayed) {
      await manager.relay(makerV2, method, params, wallet, [owner]);
    } else {
      await makerV2[method](...params, { gasLimit: 2000000, from: owner });
    }
    const walletAfter = (await dai.balanceOf(wallet.address)).add(await sai.balanceOf(wallet.address));
    const investedAfter = await makerV2.dsrBalance(wallet.address);
    const deltaInvested = toPot ? investedAfter.sub(investedBefore) : investedBefore.sub(investedAfter);
    const deltaWallet = toPot ? walletBefore.sub(walletAfter) : walletAfter.sub(walletBefore);
    // DAI in DSR should have changed
    expect(deltaInvested).to.be.gt.BN(0);
    // DAI in wallet should have changed
    expect(deltaWallet).to.be.gt.BN(0);

    if (all) {
      // Pot should be emptied
      expect(investedAfter).to.be.zero;
      // DAI in wallet should have increased
      expect(walletAfter).to.be.gt.BN(walletBefore);
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
