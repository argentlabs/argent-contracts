/* global accounts */
const { parseEther, bigNumberify } = require("ethers").utils;
const {
  deployMaker, deployUniswap, ETH_PER_DAI, ETH_PER_MKR,
} = require("../utils/defi-deployer");
const { bigNumToBytes32, ETH_TOKEN } = require("../utils/utilities.js");
const TestManager = require("../utils/test-manager");

const Wallet = require("../build-legacy/BaseWallet");
const Registry = require("../build-legacy/ModuleRegistry");
const GuardianStorage = require("../build-legacy/GuardianStorage");
const MakerManager = require("../build-legacy/LegacyMakerManager");

// Testing the LegacyMakerManager contract
describe("LegacyMakerManager Module", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;

  let deployer;
  let loanManager;
  let wallet;
  let sai;
  let gov;
  let tub;
  let uniswapFactory;
  let pip;

  before(async () => {
    deployer = manager.newDeployer();

    // Deploy Maker
    const mk = await deployMaker(deployer, infrastructure);
    [sai, gov, pip, tub] = [mk.sai, mk.gov, mk.pip, mk.tub];

    const registry = await deployer.deploy(Registry);
    const guardianStorage = await deployer.deploy(GuardianStorage);

    // Deploy & setup Uniswap for purchase of MKR and DAI
    const uni = await deployUniswap(deployer, manager, infrastructure, [gov, sai], [ETH_PER_MKR, ETH_PER_DAI]);
    uniswapFactory = uni.uniswapFactory;

    loanManager = await deployer.deploy(
      MakerManager,
      {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      tub.contractAddress,
      uniswapFactory.contractAddress,
    );
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [loanManager.contractAddress]);
    await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther("5") });
  });

  describe("Loan", () => {
    async function testOpenLoan({ ethAmount, daiAmount, relayed }) {
      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      const beforeDAI = await sai.balanceOf(wallet.contractAddress);
      const beforeDAISupply = await sai.totalSupply();

      const params = [wallet.contractAddress, ETH_TOKEN, ethAmount, sai.contractAddress, daiAmount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(loanManager, "openLoan", params, wallet, [owner]);
      } else {
        const tx = await loanManager.from(owner).openLoan(...params, { gasLimit: 2000000 });
        txReceipt = await loanManager.verboseWaitForTransaction(tx);
      }
      const loanId = txReceipt.events.find((e) => e.event === "LoanOpened").args._loanId;
      assert.isDefined(loanId, "Loan ID should be defined");

      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
      const afterDAI = await sai.balanceOf(wallet.contractAddress);
      const afterDAISupply = await sai.totalSupply();

      assert.equal(beforeETH.sub(afterETH).toString(), ethAmount.toString(), `wallet should have ${ethAmount} less ETH (relayed: ${relayed})`);
      assert.equal(afterDAI.sub(beforeDAI).toString(), daiAmount.toString(), `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`);
      assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), daiAmount.toString(),
        `${daiAmount} DAI should have been minted (relayed: ${relayed})`);

      return loanId;
    }

    describe("Open Loan", () => {
      it("should open a Loan (blockchain tx)", async () => {
        await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("6.6"), relayed: false });
      });
      it("should open a Loan (relayed tx)", async () => {
        await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("6.6"), relayed: true });
      });
    });

    async function testChangeCollateral({
      loanId, ethAmount, add, relayed,
    }) {
      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      const method = add ? "addCollateral" : "removeCollateral";
      const params = [wallet.contractAddress, loanId, ETH_TOKEN, ethAmount];
      if (relayed) {
        await manager.relay(loanManager, method, params, wallet, [owner]);
      } else {
        await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
      }
      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
      const expectedETHChange = ethAmount.mul(add ? -1 : 1).toString();
      assert.equal(afterETH.sub(beforeETH).toString(), expectedETHChange,
        `wallet ETH should have changed by ${expectedETHChange} (relayed: ${relayed})`);
    }

    describe("Add/Remove Collateral", () => {
      it("should add collateral (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("2"), relayed: false });
        await testChangeCollateral({
          loanId, ethAmount: parseEther("0.010"), add: true, relayed: false,
        });
      });
      it("should add collateral (relayed tx)", async () => {
        const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("2"), relayed: true });
        await testChangeCollateral({
          loanId, ethAmount: parseEther("0.010"), add: true, relayed: true,
        });
      });
      it("should remove collateral (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("2"), relayed: false });
        await testChangeCollateral({
          loanId, ethAmount: parseEther("0.010"), add: false, relayed: false,
        });
      });
      it("should remove collateral (relayed tx)", async () => {
        const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("2"), relayed: true });
        await testChangeCollateral({
          loanId, ethAmount: parseEther("0.010"), add: false, relayed: true,
        });
      });
    });

    async function testChangeDebt({
      loanId, daiAmount, add, relayed,
    }) {
      const beforeDAI = await sai.balanceOf(wallet.contractAddress);
      const beforeDAISupply = await sai.totalSupply();
      const method = add ? "addDebt" : "removeDebt";
      const params = [wallet.contractAddress, loanId, sai.contractAddress, daiAmount];
      if (relayed) {
        await manager.relay(loanManager, method, params, wallet, [owner]);
      } else {
        await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
      }
      const afterDAI = await sai.balanceOf(wallet.contractAddress);
      const afterDAISupply = await sai.totalSupply();
      const expectedDAIChange = daiAmount.mul(add ? 1 : -1).toString();
      assert.equal(afterDAI.sub(beforeDAI).toString(), expectedDAIChange,
        `wallet DAI should have changed by ${expectedDAIChange} (relayed: ${relayed})`);
      assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), expectedDAIChange,
        `total DAI supply should have changed by ${expectedDAIChange} (relayed: ${relayed})`);
    }

    describe("Increase Debt", () => {
      it("should increase debt (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("1"), relayed: false });
        await testChangeDebt({
          loanId, daiAmount: parseEther("0.5"), add: true, relayed: false,
        });
      });
      it("should increase debt (relayed tx)", async () => {
        const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("1"), relayed: true });
        await testChangeDebt({
          loanId, daiAmount: parseEther("0.5"), add: true, relayed: true,
        });
      });
    });

    async function testRepayDebt({ useOwnMKR, relayed }) {
      if (useOwnMKR) {
        await gov["mint(address,uint256)"](wallet.contractAddress, parseEther("0.1"));
      }
      const loanId = await testOpenLoan({ ethAmount: parseEther("0.0100"), daiAmount: parseEther("0.1"), relayed });
      await manager.increaseTime(3600 * 24 * 365); // wait one year
      const beforeMKR = await gov.balanceOf(wallet.contractAddress);
      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      await testChangeDebt({
        loanId, daiAmount: parseEther("0.00000005"), add: false, relayed,
      });
      const afterMKR = await gov.balanceOf(wallet.contractAddress);
      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

      if (useOwnMKR) assert.isTrue(afterMKR.lt(beforeMKR) && afterETH.eq(beforeETH), "governance fee should have been paid in MKR");
      else assert.isTrue(afterMKR.eq(beforeMKR) && afterETH.lt(beforeETH), "governance fee should have been paid in ETH");
    }

    describe("Repay Debt", () => {
      it("should repay debt when paying fee in MKR (blockchain tx)", async () => {
        await testRepayDebt({ useOwnMKR: true, relayed: false });
      });
      it("should repay debt when paying fee in MKR (relayed tx)", async () => {
        await testRepayDebt({ useOwnMKR: true, relayed: true });
      });
      it("should repay debt when paying fee in ETH (blockchain tx)", async () => {
        await testRepayDebt({ useOwnMKR: false, relayed: false });
      });
      it("should repay debt when paying fee in ETH (relayed tx)", async () => {
        await testRepayDebt({ useOwnMKR: false, relayed: true });
      });
    });

    async function testCloseLoan({ useOwnMKR, relayed, biteBeforeClose = false }) {
      if (useOwnMKR) {
        await gov["mint(address,uint256)"](wallet.contractAddress, parseEther("0.1"));
      }

      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      const beforeMKR = await gov.balanceOf(wallet.contractAddress);
      const beforeDAI = await sai.balanceOf(wallet.contractAddress);
      const beforeDAISupply = await sai.totalSupply();

      const loanId = await testOpenLoan({ ethAmount: parseEther("0.100"), daiAmount: parseEther("1"), relayed });
      await manager.increaseTime(3600 * 24 * 365); // wait one year

      if (biteBeforeClose) {
        const feed = bigNumberify(await pip.read());
        const newFeed = bigNumToBytes32(feed.div(10));
        await pip.poke(newFeed, { gasLimit: 500000 });
        await tub.bite(loanId);
        await pip.poke(feed, { gasLimit: 500000 });
      }
      const method = "closeLoan";
      const params = [wallet.contractAddress, loanId];
      if (relayed) {
        await manager.relay(loanManager, method, params, wallet, [owner]);
      } else {
        await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
      }

      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
      const afterMKR = await gov.balanceOf(wallet.contractAddress);
      const afterDAI = await sai.balanceOf(wallet.contractAddress);
      const afterDAISupply = await sai.totalSupply();

      if (!biteBeforeClose) { // Note that the DAI will still be in the wallet if the wallet was bitten before the closing of the cdp
        assert.isTrue(afterDAI.eq(beforeDAI), `wallet DAI should not have changed (relayed: ${relayed})`);
        assert.isTrue(afterDAISupply.eq(beforeDAISupply), `total DAI supply should not have changed (relayed: ${relayed})`);
      }

      if (useOwnMKR) assert.isTrue(afterMKR.lt(beforeMKR) && afterETH.eq(beforeETH), "governance fee should have been paid in MKR");
      else assert.isTrue(afterMKR.eq(beforeMKR) && afterETH.lt(beforeETH), "governance fee should have been paid in ETH");
      assert.equal(await tub.lad(loanId), "0x0000000000000000000000000000000000000000", "CDP should have been wiped");
    }

    describe("Close CDP", () => {
      it("should close CDP when paying fee in MKR (blockchain tx)", async () => {
        await testCloseLoan({ useOwnMKR: true, relayed: false });
      });
      it("should close CDP when paying fee in MKR (relayed tx)", async () => {
        await testCloseLoan({ useOwnMKR: true, relayed: true });
      });
      it("should close CDP when paying fee in ETH (blockchain tx)", async () => {
        await testCloseLoan({ useOwnMKR: false, relayed: false });
      });
      it("should close CDP when paying fee in ETH (relayed tx)", async () => {
        await testCloseLoan({ useOwnMKR: false, relayed: true });
      });
      it("should close CDP after it got liquidated (blockchain tx)", async () => {
        await testCloseLoan({ useOwnMKR: false, relayed: false, biteBeforeClose: true });
      });
      it("should close CDP after it got liquidated (relayed tx)", async () => {
        await testCloseLoan({ useOwnMKR: false, relayed: true, biteBeforeClose: true });
      });
    });
  });
});
