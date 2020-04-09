const ethers = require("ethers");
const {
  bigNumToBytes32, ETH_TOKEN, RAY, ETH_PER_DAI, ETH_PER_MKR,
} = require("../utils/utilities.js");
const { deployMaker, deployUniswap } = require("../utils/defi-deployer");

const { parseEther, formatBytes32String, bigNumberify } = ethers.utils;
const { HashZero, AddressZero } = ethers.constants;

const TestManager = require("../utils/test-manager");
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

/* global accounts */
describe("MakerV2 Vaults", function () {
  this.timeout(100000);

  const manager = new TestManager();
  const { deployer } = manager;

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const owner2 = accounts[2].signer;

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
    // Deploy Maker
    const mk = await deployMaker(deployer, infrastructure);
    [sai, dai, gov, bat, weth, vat, batJoin, cdpManager, pot, jug, migration] = [
      mk.sai, mk.dai, mk.gov, mk.bat, mk.weth, mk.vat, mk.batJoin, mk.cdpManager, mk.pot, mk.jug, mk.migration,
    ];
    const { wethJoin, tub } = mk;

    // Deploy Uniswap
    const uni = await deployUniswap(deployer, manager, infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);
    uniswapFactory = uni.uniswapFactory;

    // Deploy MakerV2Manager
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

    // Deploy MakerManager
    makerV1 = await deployer.deploy(
      MakerV1Manager,
      {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      tub.contractAddress,
      uniswapFactory.contractAddress,
    );

    // Deploy TransferManager
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
    const collateralAmount = dust.div(spot).mul(2);
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
    it("should not open a loan for the wrong debt token", async () => {
      await assert.revertWith(
        makerV2.from(owner).openLoan(walletAddress, ETH_TOKEN, collateralAmount, sai.contractAddress, daiAmount),
        "MV2: debt token not DAI",
      );
    });
    it("should not open a loan for an unsupported collateral token", async () => {
      await assert.revertWith(
        makerV2.from(owner).openLoan(walletAddress, sai.contractAddress, collateralAmount, dai.contractAddress, daiAmount),
        "MV2: unsupported collateral",
      );
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
    it("should not add collateral for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const wallet2 = await deployer.deploy(Wallet);
      await wallet2.init(owner2.address, [makerV2.contractAddress]);
      await assert.revertWith(
        makerV2.from(owner2).addCollateral(wallet2.contractAddress, loanId, ETH_TOKEN, parseEther("0.010")),
        "MV2: unauthorized loanId",
      );
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
    it("should not remove collateral with invalid collateral amount", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await assert.revertWith(
        makerV2.from(owner).removeCollateral(walletAddress, loanId, ETH_TOKEN, bigNumberify(2).pow(255)),
        "MV2: int overflow",
      );
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
    it("should not repay debt when only dust left", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await assert.revertWith(
        makerV2.from(owner).removeDebt(walletAddress, loanId, dai.contractAddress, daiAmount.sub(1)),
        "MV2: repay less or full",
      );
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

    it("should not allow non-module to give vault", async () => {
      await assert.revertWith(makerV2.from(owner).giveVault(walletAddress, formatBytes32String("")), "MV2: sender unauthorized");
    });
  });
});
