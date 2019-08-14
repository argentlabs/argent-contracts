const TestManager = require("../utils/test-manager");
const DydxManager = require("../build/DydxManager");
const GuardianStorage = require("../build/GuardianStorage");
const Registry = require("../build/ModuleRegistry");
const Wallet = require("../build/BaseWallet");
const ERC20 = require("../build/TestERC20");

// Dydx
const AdminImpl = require("../build/AdminImpl");
const OperationImpl = require("../build/OperationImpl");
const SoloMargin = require("../build/TestSoloMargin");
const PriceOracle = require("../build/TestPriceOracle");
const InterestSetter = require("../build/PolynomialInterestSetter");
const {
  getPolynomialParams,
  getRiskLimits,
  getRiskParams
} = require("../utils/defi/dydx/helpers");

const { parseEther, bigNumberify } = require("ethers").utils;
const WAD = bigNumberify("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = WAD.mul("100");

describe("Invest with Dydx", function () {
  this.timeout(1000000);

  const manager = new TestManager(accounts, "ganache");

  let infrastructure = accounts[0].signer;
  let owner = accounts[1].signer;
  let daiBorrower = accounts[2].signer;
  let wethBorrower = accounts[3].signer;

  let wallet, investManager, dai, weth, solo, marketIds;

  before(async () => {
    deployer = manager.newDeployer();

    /* Deploy dYdX Architecture */

    // deploy tokens
    dai = await deployer.deploy(
      ERC20,
      {},
      [infrastructure.address, daiBorrower.address, wethBorrower.address],
      10000000,
      18
    );
    weth = await deployer.deploy(
      ERC20,
      {},
      [infrastructure.address, daiBorrower.address, wethBorrower.address],
      10000000,
      18
    );

    // deploy and setup oracle
    const oracle = await deployer.deploy(PriceOracle);
    await oracle.setPrice(dai.contractAddress, WAD);
    await oracle.setPrice(weth.contractAddress, ETH_EXCHANGE_RATE);

    // deploy and setup interest setter
    const interestSetter = await deployer.deploy(
      InterestSetter,
      {},
      await getPolynomialParams("mainnet")
    );

    // deploy solo
    const adminImpl = await deployer.deploy(AdminImpl);
    const opImpl = await deployer.deploy(OperationImpl);
    solo = await deployer.deploy(
      SoloMargin,
      {
        AdminImpl: adminImpl.contractAddress,
        OperationImpl: opImpl.contractAddress
      },
      await getRiskParams("mainnet"),
      await getRiskLimits()
    );

    // add markets to solo
    marketIds = {};
    const tokens = [dai, weth];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      marketIds[token.contractAddress] = i;
      await solo.ownerAddMarket(
        token.contractAddress,
        oracle.contractAddress,
        interestSetter.contractAddress,
        { value: "0" }, // marginPremium
        { value: "0" } // spreadPremium
      );
    }

    /* Deploy Argent Architecture */

    const registry = await deployer.deploy(Registry);
    const guardianStorage = await deployer.deploy(GuardianStorage);
    investManager = await deployer.deploy(
      DydxManager,
      {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      solo.contractAddress
    );
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [investManager.contractAddress]);
  });

  describe("Investment", () => {
    async function addInvestment(token, amount, days, relay = false) {
      await token.from(infrastructure).transfer(wallet.contractAddress, amount);
      const params = [wallet.contractAddress, token.contractAddress, amount, 0];
      let txReceipt;
      if (relay) {
        txReceipt = await manager.relay(
          investManager,
          "addInvestment",
          params,
          wallet,
          [owner]
        );
      } else {
        const tx = await investManager
          .from(owner)
          .addInvestment(...params, { gasLimit: 400000 });
        txReceipt = await investManager.verboseWaitForTransaction(tx);
      }

      assert.isTrue(
        await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"),
        "should have generated InvestmentAdded event"
      );

      await accrueInterests(days);

      const output = await investManager.getInvestment(
        wallet.contractAddress,
        token.contractAddress
      );

      assert.isTrue(
        output._tokenValue > amount,
        "investment should have gained value"
      );
      return output._tokenValue;
    }

    async function accrueInterests(days) {
      // generate borrows to create interests
      const wethCollateralAmount = WAD;
      const daiCollateralAmount = WAD.mul(100);
      const wethDebtAmount = WAD.div(10);
      const daiDebtAmount = WAD.mul(10);

      // depositing collaterals
      await deposit(daiBorrower, weth, wethCollateralAmount);
      await deposit(wethBorrower, dai, daiCollateralAmount);

      // withdrawing debts
      await withdraw(daiBorrower, dai, daiDebtAmount);
      await withdraw(wethBorrower, weth, wethDebtAmount);

      // increase time to accumulate interests
      await manager.increaseTime(3600 * 24 * days);
    }

    async function deposit(depositer, token, amount) {
      await token.from(depositer).approve(solo.contractAddress, amount);
      await _operate(depositer, token, amount, 0 /* Deposit */);
    }

    async function withdraw(withdrawer, token, amount) {
      await _operate(withdrawer, token, amount, 1 /* Withdraw */);
    }

    async function _operate(account, token, amount, actionType) {
      await solo.from(account).operate(
        [{ owner: account.address, number: 0 }],
        [
          {
            accountId: 0,
            otherAccountId: 0,
            actionType: actionType,
            primaryMarketId: marketIds[token.contractAddress],
            secondaryMarketId: 0,
            otherAddress: account.address,
            data: "0x",
            amount: {
              sign: actionType === 0,
              ref: 0 /* Delta */,
              denomination: 0 /* Wei */,
              value: amount
            }
          }
        ],
        { gasLimit: 2000000 }
      );
    }

    describe("Add Investment", () => {
      it("should invest in ERC20 for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(dai, parseEther("1"), 365, false);
      });
      it("should invest in ERC20 for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(weth, parseEther("1"), 365, true);
      });
    });

    describe("Remove Investment", () => {
      async function removeInvestment(token, fraction, relay = false) {
        const before = await addInvestment(
          token,
          parseEther("0.1"),
          365,
          false
        );

        const params = [
          wallet.contractAddress,
          token.contractAddress,
          fraction
        ];
        let txReceipt;
        if (relay) {
          txReceipt = await manager.relay(
            investManager,
            "removeInvestment",
            params,
            wallet,
            [owner]
          );
        } else {
          const tx = await investManager
            .from(owner)
            .removeInvestment(...params, { gasLimit: 400000 });
          txReceipt = await investManager.verboseWaitForTransaction(tx);
        }
        assert.isTrue(
          await utils.hasEvent(txReceipt, investManager, "InvestmentRemoved"),
          "should have generated InvestmentRemoved event"
        );

        const expected_after = Math.ceil((before * (10000 - fraction)) / 10000);
        const after = (await investManager.getInvestment(
          wallet.contractAddress,
          token.contractAddress
        ))._tokenValue;

        assert.isTrue(
          Math.abs(after - expected_after) <= 1e-6 * expected_after,
          "should have removed the correct fraction"
        );
      }

      function testRemoveERC20Investment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ERC20 investment (${
          relay ? "relay" : "blockchain"
          } tx)`, async () => {
            await removeInvestment(dai, fraction, relay);
          });
      }

      for (i = 1; i < 6; i++) {
        testRemoveERC20Investment(i * 2000, true);
        testRemoveERC20Investment(i * 2000, false);
      }
    });
  });
});
