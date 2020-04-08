const { parseEther, formatBytes32String, bigNumberify } = require("ethers").utils;
const { AddressZero } = require("ethers").constants;
const etherlime = require("etherlime-lib");
const TestManager = require("../utils/test-manager");
const UniswapFactory = require("../lib/uniswap/UniswapFactory");
const UniswapExchange = require("../lib/uniswap/UniswapExchange");
const ScdMcdMigration = require("../build/ScdMcdMigration");
const MakerV2Manager = require("../build/MakerV2Manager");
const MakerRegistry = require("../build/MakerRegistry");
const Wallet = require("../build/BaseWallet");
const GuardianStorage = require("../build/GuardianStorage");
const DSValue = require("../build/DSValue");
const DSToken = require("../build/DSToken");
const Dai = require("../build/Dai");
const Vox = require("../build/SaiVox");
const Tub = require("../build/SaiTub");
const WETH = require("../build/WETH9");
const Vat = require("../build/Vat");
const Pot = require("../build/Pot");
const Jug = require("../build/Jug");
const CdpManager = require("../build/DssCdpManager");
const GemJoin = require("../build/GemJoin");
const DaiJoin = require("../build/DaiJoin");

const RAY = bigNumberify("1000000000000000000000000000"); // 10**27
const WAD = bigNumberify("1000000000000000000"); // 10**18
const RAD = RAY.mul(WAD);
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH
const DAI_SENT = WAD.div(100000000);

describe("MakerV2 DSR & SAI<>DAI", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;

  const infrastructure = global.accounts[0].signer;
  const owner = global.accounts[1].signer;

  let wallet;
  let makerV2;
  let sai;
  let dai;
  let gov;

  before(async () => {
    //
    // Deploy SCD
    //
    sai = await deployer.deploy(DSToken, {}, formatBytes32String("SAI"));
    dai = await deployer.deploy(Dai, {}, 42);
    gov = await deployer.deploy(DSToken, {}, formatBytes32String("MKR"));
    const weth = await deployer.deploy(WETH);
    const vox = await deployer.deploy(Vox, {}, USD_PER_DAI);
    const sin = await deployer.deploy(DSToken, {}, formatBytes32String("SIN"));
    const skr = await deployer.deploy(DSToken, {}, formatBytes32String("PETH"));
    const pip = await deployer.deploy(DSValue);
    const pep = await deployer.deploy(DSValue);
    const tub = await deployer.deploy(Tub, {},
      sai.contractAddress,
      sin.contractAddress,
      skr.contractAddress,
      weth.contractAddress,
      gov.contractAddress,
      pip.contractAddress,
      pep.contractAddress,
      vox.contractAddress,
      infrastructure.address);
    // let the Tub mint PETH and DAI
    await skr.setOwner(tub.contractAddress);
    await sai.setOwner(tub.contractAddress);
    // setup USD/ETH oracle with a convertion rate of 100 USD/ETH
    await pip.poke(`0x${USD_PER_ETH.toHexString().slice(2).padStart(64, "0")}`);
    // setup USD/MKR oracle with a convertion rate of 400 USD/MKR
    await pep.poke(`0x${USD_PER_MKR.toHexString().slice(2).padStart(64, "0")}`);
    // set the total DAI debt ceiling to 50,000 DAI
    await tub.mold(formatBytes32String("cap"), parseEther("50000"));
    // set the liquidity ratio to 150%
    await tub.mold(formatBytes32String("mat"), RAY.mul(3).div(2));
    // set the governance fee to 7.5% APR
    await tub.mold(formatBytes32String("fee"), "1000000002293273137447730714");


    //
    // Deploy MCD
    //
    const vat = await deployer.deploy(Vat);
    // Setting the debt ceiling
    await vat["file(bytes32,uint256)"](formatBytes32String("Line"), "138000000000000000000000000000000000000000000000000000");
    const cdpManager = await deployer.deploy(CdpManager, {}, vat.contractAddress);
    const pot = await deployer.deploy(Pot, {}, vat.contractAddress);
    await vat.rely(pot.contractAddress);
    const jug = await deployer.deploy(Jug, {}, vat.contractAddress);
    await vat.rely(jug.contractAddress);
    const saiIlk = formatBytes32String("SAI");
    await vat.init(saiIlk);
    await vat.file(saiIlk, formatBytes32String("spot"), "100000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("line"), "100000000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("dust"), "0");
    const saiJoin = await deployer.deploy(GemJoin, {}, vat.contractAddress, saiIlk, sai.contractAddress);
    await vat.rely(saiJoin.contractAddress);
    const wethIlk = formatBytes32String("ETH-A");
    await vat.init(wethIlk);
    await vat.file(wethIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    const wethJoin = await deployer.deploy(GemJoin, {}, vat.contractAddress, wethIlk, weth.contractAddress);
    await vat.rely(wethJoin.contractAddress);
    const daiJoin = await deployer.deploy(DaiJoin, {}, vat.contractAddress, dai.contractAddress);
    // allow daiJoin to mint DAI
    await dai.rely(daiJoin.contractAddress);
    // give daiJoin some internal DAI in the vat
    await vat.suck(daiJoin.contractAddress, daiJoin.contractAddress, RAD.mul(1000000));
    const migration = await deployer.deploy(
      ScdMcdMigration,
      {},
      tub.contractAddress,
      cdpManager.contractAddress,
      saiJoin.contractAddress,
      wethJoin.contractAddress,
      daiJoin.contractAddress,
    );

    //
    // Deploy Uniswap
    //
    const uniswapFactory = await deployer.deploy(UniswapFactory);
    const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
    await uniswapFactory.initializeFactory(uniswapTemplateExchange.contractAddress);
    const ethLiquidity = parseEther("10");
    // MKR
    await uniswapFactory.from(infrastructure).createExchange(gov.contractAddress);
    const mkrExchange = await etherlime.ContractAt(UniswapExchange, await uniswapFactory.getExchange(gov.contractAddress));
    const mkrLiquidity = ethLiquidity.mul(WAD).div(ETH_PER_MKR);
    await gov["mint(address,uint256)"](infrastructure.address, mkrLiquidity);
    await gov.from(infrastructure).approve(mkrExchange.contractAddress, mkrLiquidity);
    let timestamp = await manager.getTimestamp(await manager.getCurrentBlock());
    await mkrExchange.from(infrastructure).addLiquidity(1, mkrLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 150000 });
    // DAI
    await uniswapFactory.from(infrastructure).createExchange(dai.contractAddress);
    const daiExchange = await etherlime.ContractAt(UniswapExchange, await uniswapFactory.getExchange(dai.contractAddress));
    const daiLiquidity = ethLiquidity.mul(WAD).div(ETH_PER_DAI);
    await dai["mint(address,uint256)"](infrastructure.address, daiLiquidity);
    await dai.from(infrastructure).approve(daiExchange.contractAddress, daiLiquidity);
    timestamp = await manager.getTimestamp(await manager.getCurrentBlock());
    await daiExchange.from(infrastructure).addLiquidity(1, daiLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 150000 });

    //
    // Deploy MakerV2Manager
    //
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
    it("swaps DAI to SAI (blockchain tx)", async () => {
      await swapDaiSai({ toDai: false, relayed: false });
    });
    it("swaps DAI to SAI (relayed tx)", async () => {
      await swapDaiSai({ toDai: false, relayed: true });
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
      });

      it("sends DAI to the pot (relayed tx)", async () => {
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
