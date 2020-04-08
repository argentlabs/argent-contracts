const ethers = require("ethers");
const etherlime = require("etherlime-lib");
const { bigNumToBytes32 } = require("../utils/utilities.js");

const { parseEther, bigNumberify, formatBytes32String } = ethers.utils;
const { HashZero, AddressZero } = ethers.constants;

const TestManager = require("../utils/test-manager");
const UniswapFactory = require("../lib/uniswap/UniswapFactory");
const UniswapExchange = require("../lib/uniswap/UniswapExchange");
const ScdMcdMigration = require("../build/ScdMcdMigration");
const Registry = require("../build/ModuleRegistry");
const MakerV1Manager = require("../build/MakerManager");
const MakerV2Manager = require("../build/MakerV2Manager");
const UpgradedMakerV2Manager = require("../build/TestUpgradedMakerV2Manager");
const MakerRegistry = require("../build/MakerRegistry");
const Wallet = require("../build/BaseWallet");
const GuardianStorage = require("../build/GuardianStorage");
const TransferStorage = require("../build/TransferStorage");
const TransferManager = require("../build/TransferManager");
const TokenPriceProvider = require("../build/TokenPriceProvider");
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

const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const RAY = bigNumberify("1000000000000000000000000000"); // 10**27
const WAD = bigNumberify("1000000000000000000"); // 10**18
const RAD = RAY.mul(WAD);
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH
const MAT = RAY.mul(3).div(2); // collateralization ratio = 150%

describe("MakerV2 Vaults", function () {
  this.timeout(100000);

  const manager = new TestManager();
  const { deployer } = manager;

  const infrastructure = global.accounts[0].signer;
  const owner = global.accounts[1].signer;

  let sai;
  let dai;
  let gov;
  let bat;
  let weth;
  let vat;
  let batJoin;
  let cdpManager;
  let pot;
  let jug;
  let migration;
  let registry;
  let transferManager;
  let guardianStorage;
  let makerV1;
  let makerV2;
  let wallet;
  let walletAddress;
  let makerRegistry;
  let uniswapFactory;

  before(async () => {
    //
    // Deploy and setup SCD
    //
    sai = await deployer.deploy(DSToken, {}, formatBytes32String("SAI"));
    dai = await deployer.deploy(Dai, {}, 42);
    gov = await deployer.deploy(DSToken, {}, formatBytes32String("MKR"));
    weth = await deployer.deploy(WETH);
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
    // set the collateralization ratio to 150%
    await tub.mold(formatBytes32String("mat"), MAT);
    // set the governance fee to 7.5% APR
    await tub.mold(formatBytes32String("fee"), "1000000002293273137447730714");


    //
    // Deploy and setup MCD
    //
    vat = await deployer.deploy(Vat);
    // Setting the debt ceiling
    await vat["file(bytes32,uint256)"](formatBytes32String("Line"), "138000000000000000000000000000000000000000000000000000");
    cdpManager = await deployer.deploy(CdpManager, {}, vat.contractAddress);
    pot = await deployer.deploy(Pot, {}, vat.contractAddress);
    await vat.rely(pot.contractAddress);
    jug = await deployer.deploy(Jug, {}, vat.contractAddress);
    await vat.rely(jug.contractAddress);

    // SAI collateral setup
    const saiIlk = formatBytes32String("SAI");
    await jug.init(saiIlk);
    await vat.init(saiIlk);
    await vat.file(saiIlk, formatBytes32String("spot"), "100000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("line"), "100000000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("dust"), "0");
    const saiJoin = await deployer.deploy(GemJoin, {}, vat.contractAddress, saiIlk, sai.contractAddress);
    await vat.rely(saiJoin.contractAddress);
    // WETH collateral setup
    const wethIlk = formatBytes32String("ETH-A");
    await jug.init(wethIlk);
    await vat.init(wethIlk);
    await vat.file(wethIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    const wethJoin = await deployer.deploy(GemJoin, {}, vat.contractAddress, wethIlk, weth.contractAddress);
    await vat.rely(wethJoin.contractAddress);
    // BAT collateral setup
    bat = await deployer.deploy(DSToken, {}, formatBytes32String("BAT"));
    const batIlk = formatBytes32String("BAT-A");
    await jug.init(batIlk);
    await vat.init(batIlk);
    await vat.file(batIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(batIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(batIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    batJoin = await deployer.deploy(GemJoin, {}, vat.contractAddress, batIlk, bat.contractAddress);
    await vat.rely(batJoin.contractAddress);

    // DAI debt setup
    const daiJoin = await deployer.deploy(DaiJoin, {}, vat.contractAddress, dai.contractAddress);
    // allow daiJoin to mint DAI
    await dai.rely(daiJoin.contractAddress);
    // give daiJoin some internal DAI in the vat
    await vat.suck(daiJoin.contractAddress, daiJoin.contractAddress, RAD.mul(1000000));

    // Deploy and setup SCD to MCD Migration
    migration = await deployer.deploy(
      ScdMcdMigration,
      {},
      tub.contractAddress,
      cdpManager.contractAddress,
      saiJoin.contractAddress,
      wethJoin.contractAddress,
      daiJoin.contractAddress,
    );
    // Setting up the common migration vault used by ScdMcdMigration
    const initialSaiAmountInMigrationVault = parseEther("1000");
    await sai["mint(address,uint256)"](infrastructure.address, initialSaiAmountInMigrationVault);
    await sai.from(infrastructure).approve(migration.contractAddress, initialSaiAmountInMigrationVault);
    await migration.from(infrastructure).swapSaiToDai(initialSaiAmountInMigrationVault, { gasLimit: 2000000 });

    //
    // Deploy and setup Uniswap
    //
    uniswapFactory = await deployer.deploy(UniswapFactory);
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
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    makerRegistry = await deployer.deploy(MakerRegistry);
    await makerRegistry.addCollateral(wethJoin.contractAddress);

    makerV2 = await deployer.deploy(
      MakerV2Manager,
      {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      migration.contractAddress,
      pot.contractAddress,
      jug.contractAddress,
      makerRegistry.contractAddress,
      uniswapFactory.contractAddress,
      { gasLimit: 8000000 },
    );


    // ???
    const priceProvider = await deployer.deploy(TokenPriceProvider, {}, AddressZero);
    const transferStorage = await deployer.deploy(TransferStorage);
    transferManager = await deployer.deploy(TransferManager, {},
      AddressZero,
      transferStorage.contractAddress,
      guardianStorage.contractAddress,
      priceProvider.contractAddress,
      3600,
      3600,
      10000,
      AddressZero);

    makerV1 = await deployer.deploy(
      MakerV1Manager,
      {},
      AddressZero,
      guardianStorage.contractAddress,
      tub.contractAddress,
      uniswapFactory.contractAddress,
    );
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [makerV1.contractAddress, makerV2.contractAddress, transferManager.contractAddress]);
    walletAddress = wallet.contractAddress;
    await infrastructure.sendTransaction({ to: walletAddress, value: parseEther("0.6") });
  });


  async function getTestAmounts(tokenAddress) {
    const tokenAddress_ = (tokenAddress === ETH_TOKEN) ? weth.contractAddress : tokenAddress;
    const { ilk } = await makerRegistry.collaterals(tokenAddress_);
    const { spot, dust } = await vat.ilks(ilk);
    const daiAmount = dust.div(RAY);
    const collateralAmount = dust.div(spot).mul(2);// 0).div(10);
    // const saiAmount = collateralAmount.div(ETH_PER_DAI).div(MAT).div(2);
    return { daiAmount, collateralAmount };
  }

  async function testOpenLoan({
    collateralAmount, daiAmount, relayed, collateral = { contractAddress: ETH_TOKEN },
  }) {
    const beforeCollateral = (collateral.contractAddress === ETH_TOKEN)
      ? await deployer.provider.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const beforeDAI = await dai.balanceOf(walletAddress);
    const beforeDAISupply = await dai.totalSupply();

    const method = "openLoan";
    const params = [walletAddress, collateral.contractAddress, collateralAmount, dai.contractAddress, daiAmount];
    let txR;
    if (relayed) {
      txR = await manager.relay(makerV2, method, params, wallet, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      txR = await (await makerV2.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
    }
    const loanId = txR.events.find((e) => e.event === "LoanOpened").args._loanId;
    assert.isDefined(loanId, "Loan ID should be defined");

    const afterCollateral = (collateral.contractAddress === ETH_TOKEN)
      ? await deployer.provider.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);
    const afterDAI = await dai.balanceOf(walletAddress);
    const afterDAISupply = await dai.totalSupply();

    assert.equal(
      beforeCollateral.sub(afterCollateral).toString(),
      collateralAmount.toString(),
      `wallet should have ${collateralAmount} less collateral (relayed: ${relayed})`,
    );
    assert.equal(
      afterDAI.sub(beforeDAI).toString(),
      daiAmount.toString(),
      `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`,
    );
    assert.equal(
      afterDAISupply.sub(beforeDAISupply).toString(),
      daiAmount.toString(),
      `${daiAmount} DAI should have been minted (relayed: ${relayed})`,
    );

    return loanId;
  }

  describe("Open Loan", () => {
    let daiAmount;
    let collateralAmount;
    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });

    it("should open a Loan (blockchain tx)", async () => {
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
    });

    it("should open a Loan (relayed tx)", async () => {
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
    });

    it("should open>close>reopen a Loan (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await makerV2.from(owner).closeLoan(walletAddress, loanId, { gasLimit: 4500000 });
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
    });

    it("should open>close>reopen a Loan (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await (await makerV2.from(owner).closeLoan(walletAddress, loanId, { gasLimit: 4500000 })).wait();
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
    });
  });

  async function testChangeCollateral({
    loanId, collateralAmount, add, relayed, collateral = { contractAddress: ETH_TOKEN }, makerV2Manager = makerV2,
  }) {
    const beforeCollateral = (collateral.contractAddress === ETH_TOKEN)
      ? await deployer.provider.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const method = add ? "addCollateral" : "removeCollateral";
    const params = [wallet.contractAddress, loanId, collateral.contractAddress, collateralAmount];
    if (relayed) {
      const txR = await manager.relay(makerV2Manager, method, params, wallet, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      await makerV2Manager.from(owner)[method](...params, { gasLimit: 2000000 });
    }

    const afterCollateral = (collateral.contractAddress === ETH_TOKEN)
      ? await deployer.provider.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const expectedCollateralChange = collateralAmount.mul(add ? -1 : 1).toString();
    assert.equal(
      afterCollateral.sub(beforeCollateral).toString(),
      expectedCollateralChange,
      `wallet collateral should have changed by ${expectedCollateralChange} (relayed: ${relayed})`,
    );
  }

  describe("Add/Remove Collateral", () => {
    let daiAmount; let
      collateralAmount;
    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });
    it("should add collateral (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: true, relayed: false,
      });
    });
    it("should add collateral (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: true, relayed: true,
      });
    });
    it("should remove collateral (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: false, relayed: false,
      });
    });
    it("should remove collateral (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: false, relayed: true,
      });
    });
  });

  async function testChangeDebt({
    loanId, daiAmount, add, relayed,
  }) {
    const beforeDAI = await dai.balanceOf(wallet.contractAddress);
    const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
    const method = add ? "addDebt" : "removeDebt";
    const params = [wallet.contractAddress, loanId, dai.contractAddress, daiAmount];
    if (relayed) {
      const txR = await manager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      await makerV2.from(owner)[method](...params, { gasLimit: 2000000 });
    }
    const afterDAI = await dai.balanceOf(wallet.contractAddress);
    const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
    if (add) {
      assert.equal(
        afterDAI.sub(beforeDAI).toString(),
        daiAmount.toString(),
        `wallet DAI should have increased by ${daiAmount.toString()} (relayed: ${relayed})`,
      );
    } else {
      assert.isTrue(
        afterDAI.lt(beforeDAI) || afterETH.lt(beforeETH),
        `wallet DAI or ETH should have decreased (relayed: ${relayed})`,
      );
    }
  }

  describe("Increase Debt", () => {
    let daiAmount; let
      collateralAmount;
    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });
    it("should increase debt (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeDebt({
        loanId, daiAmount: parseEther("0.5"), add: true, relayed: false,
      });
    });
    it("should increase debt (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeDebt({
        loanId, daiAmount: parseEther("0.5"), add: true, relayed: true,
      });
    });
  });

  async function testRepayDebt({ useDai, relayed }) {
    const { collateralAmount, daiAmount: daiAmount_ } = await getTestAmounts(ETH_TOKEN);
    const daiAmount = daiAmount_.add(parseEther("0.3"));

    const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
    if (!useDai) {
      // move the borrowed DAI from the wallet to the owner
      await transferManager.from(owner).transferToken(walletAddress, dai.contractAddress, owner.address, daiAmount, HashZero, { gasLimit: 3000000 });
      // give some ETH to the wallet to be used for repayment
      await owner.sendTransaction({ to: walletAddress, value: collateralAmount });
    }
    await manager.increaseTime(3); // wait 3 seconds
    const beforeDAI = await dai.balanceOf(wallet.contractAddress);
    const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
    await testChangeDebt({
      loanId, daiAmount: parseEther("0.2"), add: false, relayed,
    });

    const afterDAI = await dai.balanceOf(wallet.contractAddress);
    const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

    if (useDai) assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.eq(beforeETH), "should have less DAI");
    else assert.isTrue(afterDAI.eq(beforeDAI) && afterETH.lt(beforeETH), "should have less ETH");
  }

  describe("Repay Debt", () => {
    it("should repay debt when paying fee in DAI (blockchain tx)", async () => {
      await testRepayDebt({ useDai: true, relayed: false });
    });
    it("should repay debt when paying fee in DAI (relayed tx)", async () => {
      await testRepayDebt({ useDai: true, relayed: true });
    });
    it("should repay debt when paying fee in ETH (blockchain tx)", async () => {
      await testRepayDebt({ useDai: false, relayed: false });
    });
    it("should repay debt when paying fee in ETH (relayed tx)", async () => {
      await testRepayDebt({ useDai: false, relayed: true });
    });
  });

  async function testCloseLoan({ useDai, relayed }) {
    const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
    const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
    // give some ETH to the wallet to be used for repayment
    await owner.sendTransaction({ to: walletAddress, value: collateralAmount.mul(2) });
    if (!useDai) {
      // move the borrowed DAI from the wallet to the owner
      await transferManager.from(owner).transferToken(walletAddress, dai.contractAddress, owner.address, daiAmount, HashZero, { gasLimit: 3000000 });
    }
    await manager.increaseTime(3); // wait 3 seconds
    const beforeDAI = await dai.balanceOf(wallet.contractAddress);
    const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
    const method = "closeLoan";
    const params = [wallet.contractAddress, loanId];
    if (relayed) {
      const txR = await manager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      await makerV2.from(owner)[method](...params, { gasLimit: 3000000 });
    }
    const afterDAI = await dai.balanceOf(wallet.contractAddress);
    const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

    if (useDai) assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.sub(collateralAmount).lt(beforeETH), "should have spent some DAI and some ETH");
    else assert.isTrue(afterDAI.eq(beforeDAI) && afterETH.sub(collateralAmount).lt(beforeETH), "should have spent some ETH");
  }

  describe("Close Vaults", () => {
    it("should close a vault when paying fee in DAI + ETH (blockchain tx)", async () => {
      await testCloseLoan({ useDai: true, relayed: false });
    });
    it("should close a vault when paying fee in DAI + ETH (relayed tx)", async () => {
      await testCloseLoan({ useDai: true, relayed: true });
    });
    it("should close a vault when paying fee in ETH (blockchain tx)", async () => {
      await testCloseLoan({ useDai: false, relayed: false });
    });
    it("should close a vault when paying fee in ETH (relayed tx)", async () => {
      await testCloseLoan({ useDai: false, relayed: true });
    });
  });

  describe("Adding new collateral token to registry", () => {
    it("should open a loan with a newly added collateral token", async () => {
      await makerRegistry.addCollateral(batJoin.contractAddress);
      const { daiAmount, collateralAmount } = await getTestAmounts(bat.contractAddress);
      await bat["mint(address,uint256)"](walletAddress, collateralAmount);
      await testOpenLoan({
        collateralAmount, daiAmount, collateral: bat, relayed: false,
      });
      await manager.increaseTime(3); // wait 3 seconds
    });
  });

  describe("Acquiring a wallet's vault", () => {
    async function testAcquireVault({ relayed }) {
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.contractAddress);
      let txR = await (await cdpManager.from(owner).open(ilk, owner.address)).wait();
      const vaultId = txR.events.find((e) => e.event === "NewCdp").args.cdp;
      // Transfer the vault to the wallet
      await cdpManager.from(owner).give(vaultId, walletAddress);
      // Transfer the vault to the module
      const loanId = bigNumToBytes32(vaultId);
      const method = "acquireLoan";
      const params = [walletAddress, loanId];
      if (relayed) {
        txR = await manager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2.from(owner)[method](...params, { gasLimit: 1000000 });
      }
      // Add some collateral and debt
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testChangeCollateral({
        loanId, collateralAmount, add: true, relayed, makerV2,
      });
      await testChangeDebt({
        loanId, daiAmount, add: true, relayed,
      });
    }

    it("should transfer a vault from a wallet to the module (blockchain tx)", async () => {
      await testAcquireVault({ relayed: false });
    });

    it("should transfer a vault from a wallet to the module (relayed tx)", async () => {
      await testAcquireVault({ relayed: true });
    });
  });

  describe("Migrating an SCD CDP to an MCD vault", () => {
    let oldCdpId;
    beforeEach(async () => {
      // Opening SCD CDP
      const { daiAmount, collateralAmount } = await getTestAmounts(ETH_TOKEN);
      const params = [walletAddress, ETH_TOKEN, collateralAmount, sai.contractAddress, daiAmount];
      const txReceipt = await (await makerV1.from(owner).openLoan(...params, { gasLimit: 2000000 })).wait();
      oldCdpId = txReceipt.events.find((e) => e.event === "LoanOpened").args._loanId;
      assert.isDefined(oldCdpId, "The old CDP ID should be defined");
    });

    async function testMigrateCdp({ relayed }) {
      const method = "migrateCdp";
      const params = [walletAddress, oldCdpId];
      let txR;
      if (relayed) {
        txR = await manager.relay(makerV2, method, params, wallet, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        txR = await (await makerV2.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
      }
      const loanId = txR.events.find((e) => e.event === "CdpMigrated").args._newVaultId;
      assert.isDefined(loanId, "The new vault ID should be defined");
    }

    it("should migrate a CDP (blockchain tx)", async () => {
      await testMigrateCdp({ relayed: false });
    });

    it("should migrate a CDP (relayed tx)", async () => {
      await testMigrateCdp({ relayed: true });
    });
  });

  describe("Upgrade of MakerV2Manager", () => {
    let upgradedMakerV2;
    let daiAmount;
    let collateralAmount;
    beforeEach(async () => {
      // Generate test amounts
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;

      // Deploy the upgraded MakerV2 module
      upgradedMakerV2 = await deployer.deploy(
        UpgradedMakerV2Manager,
        {},
        registry.contractAddress,
        guardianStorage.contractAddress,
        migration.contractAddress,
        pot.contractAddress,
        jug.contractAddress,
        makerRegistry.contractAddress,
        uniswapFactory.contractAddress,
        makerV2.contractAddress,
        { gasLimit: 10700000 },
      );

      // Register the upgraded MakerV2 module in the ModuleRegistry
      await registry.registerModule(upgradedMakerV2.contractAddress, formatBytes32String("UpgradedMakerV2Manager"));

      // Adding BAT to the registry of supported collateral tokens
      if (!(await makerRegistry.collaterals(bat.contractAddress)).exists) {
        await makerRegistry.addCollateral(batJoin.contractAddress);
      }
    });

    async function testUpgradeModule({ relayed, withBatVault = false }) {
      // Open a WETH vault with the old MakerV2 module
      const loanId1 = await testOpenLoan({ collateralAmount, daiAmount, relayed });
      let loanId2;
      if (withBatVault) {
        // Open a BAT vault with the old MakerV2 module
        const batTestAmounts = await getTestAmounts(bat.contractAddress);
        await bat["mint(address,uint256)"](walletAddress, batTestAmounts.collateralAmount.add(parseEther("0.01")));
        loanId2 = await testOpenLoan({
          collateralAmount: batTestAmounts.collateralAmount,
          daiAmount: batTestAmounts.daiAmount,
          collateral: bat,
          relayed,
        });
      }

      // Add the upgraded module
      const method = "addModule";
      const params = [walletAddress, upgradedMakerV2.contractAddress];
      if (relayed) {
        const txR = await manager.relay(makerV2, method, params, wallet, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2.from(owner)[method](...params, { gasLimit: 2000000 });
      }

      // Make sure that the vaults can be manipulated from the upgraded module
      await testChangeCollateral({
        loanId: loanId1,
        collateralAmount: parseEther("0.010"),
        add: true,
        relayed,
        makerV2Manager: upgradedMakerV2,
      });
      await upgradedMakerV2.from(owner).closeLoan(walletAddress, loanId1, { gasLimit: 4500000 });

      if (withBatVault) {
        await testChangeCollateral({
          loanId: loanId2,
          collateralAmount: parseEther("0.010"),
          add: true,
          relayed,
          collateral: bat,
          makerV2Manager: upgradedMakerV2,
        });
        await upgradedMakerV2.from(owner).closeLoan(walletAddress, loanId2, { gasLimit: 4500000 });
      }
    }

    it("should move a vault after a module upgrade (blockchain tx)", async () => {
      await testUpgradeModule({ relayed: false });
    });

    it("should move a vault after a module upgrade (relayed tx)", async () => {
      await testUpgradeModule({ relayed: true });
    });

    it("should move 2 vaults after a module upgrade (blockchain tx)", async () => {
      await testUpgradeModule({ withBatVault: true, relayed: false });
    });

    it("should move 2 vaults after a module upgrade (relayed tx)", async () => {
      await testUpgradeModule({ withBatVault: true, relayed: true });
    });
  });
});
