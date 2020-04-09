const { AddressZero } = require("ethers").constants;
const { WAD, ETH_PER_DAI, ETH_PER_MKR } = require("../utils/utilities.js");
const { deployMaker, deployUniswap } = require("../utils/defi-deployer");
const TestManager = require("../utils/test-manager");
const MakerV2Manager = require("../build/MakerV2Manager");
const MakerRegistry = require("../build/MakerRegistry");
const Wallet = require("../build/BaseWallet");
const GuardianStorage = require("../build/GuardianStorage");

const DAI_SENT = WAD.div(100000000);

/* global accounts */
describe("MakerV2 DSR & SAI<>DAI", function () {
  this.timeout(100000);

  const manager = new TestManager();
  const { deployer } = manager;

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;

  let wallet;
  let makerV2;
  let sai;
  let dai;
  let gov;

  before(async () => {
    // Deploy Maker
    const m = await deployMaker(deployer, infrastructure);
    [sai, dai, gov] = [m.sai, m.dai, m.gov];
    const { migration, pot, jug } = m;

    // Deploy Uniswap
    const { uniswapFactory } = await deployUniswap(deployer, manager, infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);

    // Deploy MakerV2Manager
    const makerRegistry = await deployer.deploy(MakerRegistry);
    const guardianStorage = await deployer.deploy(GuardianStorage);
    makerV2 = await deployer.deploy(
      MakerV2Manager,
      {},
      AddressZero,
      guardianStorage.contractAddress,
      migration.contractAddress,
      pot.contractAddress,
      jug.contractAddress,
      makerRegistry.contractAddress,
      uniswapFactory.contractAddress,
      { gasLimit: 8000000 },
    );
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [makerV2.contractAddress]);
    await sai["mint(address,uint256)"](wallet.contractAddress, DAI_SENT.mul(20));
    await dai["mint(address,uint256)"](wallet.contractAddress, DAI_SENT.mul(20));
  });

  describe("DAI <> SAI", () => {
    async function swapDaiSai({ toDai, relayed }) {
      const originToken = toDai ? sai : dai;
      const destinationToken = toDai ? dai : sai;
      const originBefore = await originToken.balanceOf(wallet.contractAddress);
      const destinationBefore = await destinationToken.balanceOf(wallet.contractAddress);
      const method = toDai ? "swapSaiToDai" : "swapDaiToSai";
      const params = [wallet.contractAddress, DAI_SENT];

      if (relayed) {
        await manager.relay(makerV2, method, params, wallet, [owner]);
      } else {
        await (await makerV2.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
      }

      const originAfter = await originToken.balanceOf(wallet.contractAddress);
      const destinationAfter = await destinationToken.balanceOf(wallet.contractAddress);
      assert.isTrue(destinationAfter.sub(destinationBefore).eq(DAI_SENT), `wallet should have received ${toDai ? "DAI" : "SAI"}`);
      assert.isTrue(originBefore.sub(originAfter).eq(DAI_SENT), `wallet should have sent ${toDai ? "SAI" : "DAI"}`);
    }
    it("swaps SAI to DAI (blockchain tx)", async () => {
      await swapDaiSai({ toDai: true, relayed: false });
    });
    it("swaps SAI to DAI (relayed tx)", async () => {
      await swapDaiSai({ toDai: true, relayed: true });
    });
    it("does not swap SAI to DAI with insufficient SAI (blockchain tx)", async () => {
      await assert.revertWith(makerV2.from(owner).swapSaiToDai(wallet.contractAddress, DAI_SENT.mul(1000)), "MV2: insufficient SAI");
    });
    it("swaps DAI to SAI (blockchain tx)", async () => {
      await swapDaiSai({ toDai: false, relayed: false });
    });
    it("swaps DAI to SAI (relayed tx)", async () => {
      await swapDaiSai({ toDai: false, relayed: true });
    });
    it("does not swap DAI to SAI with insufficient DAI (blockchain tx)", async () => {
      await assert.revertWith(makerV2.from(owner).swapDaiToSai(wallet.contractAddress, DAI_SENT.mul(1000)), "MV2: insufficient DAI");
    });
  });

  describe("DSR", () => {
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
});
