/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));
const utils = require("../utils/utilities.js");
const { setupWalletVersion } = require("../utils/wallet_definition.js");
const RelayManager = require("../utils/relay-manager");

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");
const ERC20 = artifacts.require("TestERC20");
const TestContract = artifacts.require("TestContract");
const WETH = artifacts.require("WETH9");

const SECURITY_WINDOW = 240;

contract("ApprovedTransfer", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const guardian2 = accounts[3];
  const guardian3 = accounts[4];
  const recipient = accounts[5];

  let wallet;
  let registry;
  let relayerManager;
  let approvedTransfer;

  let erc20;
  let weth;
  const amountToTransfer = 10000;
  let contract;

  before(async () => {  
    weth = await WETH.new();
    const modules = await setupWalletVersion({ wethToken: weth.address });
    registry = modules.registry;
    relayerManager = modules.relayerManager;
    await manager.setRelayerManager(relayerManager);
    approvedTransfer = modules.approvedTransfer;
  });

  beforeEach(async () => {
    const proxy = await DelegateProxy.new(registry.address, owner, guardian1);
    wallet = await IWallet.at(proxy.address);

    const decimals = 12; // number of decimal for TOKN contract
    erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await wallet.send(50000000);
  });

  async function addGuardians(guardians) {
    // guardians can be IWallet or ContractWrapper objects
    for (const guardian of guardians) {
      await wallet.addGuardian(guardian, { from: owner });
    }

    await utils.increaseTime(SECURITY_WINDOW + 1);
    for (let i = 1; i < guardians.length; i += 1) {
      await wallet.confirmGuardianAddition(guardians[i]);
    }
  }

  async function createSmartContractGuardians(guardians) {
    const wallets = [];
    for (const guardian of guardians) {
      const proxy = await DelegateProxy.new(registry.address, guardian, accounts[9]);
      const guardianWallet = await IWallet.at(proxy.address);
      wallets.push(guardianWallet.address);
    }
    return wallets;
  }

  async function transferTokenApproved(_token, _signers) {
    const before = _token === utils.ETH_TOKEN ? await utils.getBalance(recipient) : await erc20.balanceOf(recipient);
    await manager.relay(wallet, "transferTokenApproved", [_token, recipient, amountToTransfer, ethers.constants.HashZero], _signers);
    const after = _token === utils.ETH_TOKEN ? await utils.getBalance(recipient) : await erc20.balanceOf(recipient);
    expect(after.sub(before)).to.eq.BN(amountToTransfer);
  }

  async function callContractApproved(_signers) {
    const before = await utils.getBalance(contract.address);
    const newState = parseInt((await contract.state()).toString(), 10) + 1;
    const dataToTransfer = contract.contract.methods.setState([newState]).encodeABI();
    await manager.relay(wallet, "callContractApproved", [contract.address, amountToTransfer, dataToTransfer], _signers);
    const after = await utils.getBalance(contract.address);

    assert.equal(after.sub(before).toNumber(), amountToTransfer, "should have transfered the ETH amount");
    assert.equal((await contract.state()).toNumber(), newState, "the state of the external contract should have been changed");
  }

  describe("Transfer", () => {
    async function expectFailingTransferToken(_token, _signers, _reason) {
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "transferTokenApproved",
          [_token, recipient, amountToTransfer, ethers.constants.HashZero],
          _signers,
        ), _reason,
      );
    }

    describe("Approved by EOA guardians", () => {
      describe("1 guardian", () => {
        it("should transfer ETH with 1 confirmation for 1 guardian", async () => {
          await transferTokenApproved(utils.ETH_TOKEN, [owner, guardian1]);
        });
        it("should fail to transfer ETH when signer is not a guardian", async () => {
          await expectFailingTransferToken(utils.ETH_TOKEN, [owner, guardian2], "RM: Invalid signatures");
        });
        it("should transfer ERC20 with 1 confirmation for 1 guardian", async () => {
          await transferTokenApproved(erc20.address, [owner, guardian1]);
        });
      });

      describe("2 guardians", () => {
        beforeEach(async () => {
          await addGuardians([guardian2]);
        });
        it("should transfer ETH with 1 confirmation for 2 guardians", async () => {
          await transferTokenApproved(utils.ETH_TOKEN, [owner, guardian1]);
        });
      });

      describe("3 guardians", () => {
        beforeEach(async () => {
          await addGuardians([guardian2, guardian3]);
        });
        it("should not transfer ETH with 1 confirmation for 3 guardians", async () => {
          await expectFailingTransferToken(utils.ETH_TOKEN, [owner, guardian1], "RM: Wrong number of signatures");
        });
        it("should transfer ETH with 2 confirmations for 3 guardians", async () => {
          await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        });
        it("should fail to transfer ERC20 with 1 confirmation for 3 guardians", async () => {
          await expectFailingTransferToken(erc20.address, [owner, guardian1], "RM: Wrong number of signatures");
        });
        it("should transfer ERC20 with 2 confirmations for 3 guardians", async () => {
          await transferTokenApproved(erc20.address, [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        });
      });
    });

    describe("Approved by smart-contract guardians", () => {
      describe("1 guardian", () => {
        beforeEach(async () => {
          await addGuardians(await createSmartContractGuardians([guardian1]));
        });
        it("should transfer ETH with 1 confirmation for 1 guardian", async () => {
          await transferTokenApproved(utils.ETH_TOKEN, [owner, guardian1]);
        });
        it("should transfer ERC20 with 1 confirmation for 1 guardian", async () => {
          await transferTokenApproved(erc20.address, [owner, guardian1]);
        });
      });

      describe("2 guardians", () => {
        beforeEach(async () => {
          await addGuardians(await createSmartContractGuardians([guardian1, guardian2]));
        });
        it("should transfer ETH with 1 confirmation for 2 guardians", async () => {
          await transferTokenApproved(utils.ETH_TOKEN, [owner, guardian1]);
        });
      });

      describe("3 guardians", () => {
        beforeEach(async () => {
          await addGuardians(await createSmartContractGuardians([guardian1, guardian2, guardian3]));
        });
        it("should not transfer ETH with 1 confirmation for 3 guardians", async () => {
          await expectFailingTransferToken(utils.ETH_TOKEN, [owner, guardian1], "RM: Wrong number of signatures");
        });
        it("should transfer ETH with 2 confirmations for 3 guardians", async () => {
          await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        });
        it("should not transfer ERC20 with 1 confirmations for 3 guardians", async () => {
          await expectFailingTransferToken(erc20.address, [owner, guardian1], "RM: Wrong number of signatures");
        });
        it("should transfer ERC20 with 2 confirmations for 3 guardians", async () => {
          await transferTokenApproved(erc20.address, [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        });
      });
    });

    describe("Approved by EOA and smart-contract guardians", () => {
      it("should transfer ETH with 1 EOA guardian and 2 smart-contract guardians", async () => {
        await addGuardians([...(await createSmartContractGuardians([guardian2, guardian3]))]);
        await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian1, guardian3])]);
        await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian2, guardian3])]);
      });
      it("should transfer ETH with 2 EOA guardians and 1 smart-contract guardian", async () => {
        await addGuardians([guardian2, ...await createSmartContractGuardians([guardian3])]);
        await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian1, guardian3])]);
        await transferTokenApproved(utils.ETH_TOKEN, [owner, ...utils.sortWalletByAddress([guardian2, guardian3])]);
      });
    });
  });

  describe("Contract call", () => {
    it("should fail to call contract on a wallet with no guardian", async () => {
      contract = await TestContract.new();
      const dataToTransfer = contract.contract.methods.setState([1]).encodeABI();

      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "callContractApproved",
          [contract.address, amountToTransfer, dataToTransfer],
          [owner],
        ),
        "AT: no guardians set on wallet",
      );
    });

    describe("Approved by 1 EOA and 2 smart-contract guardians", () => {
      beforeEach(async () => {
        contract = await TestContract.new();
        assert.equal(await contract.state(), 0, "initial contract state should be 0");
        await addGuardians([...(await createSmartContractGuardians([guardian2, guardian3]))]);
      });

      it("should call a contract and transfer ETH with 1 EOA guardian and 2 smart-contract guardians", async () => {
        await callContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        await callContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian3])]);
        await callContractApproved([owner, ...utils.sortWalletByAddress([guardian2, guardian3])]);
      });

      it.skip("should not be able to call the wallet itself", async () => {
        const txReceipt = await manager.relay(wallet, "callContractApproved",
          [wallet.address, amountToTransfer, ethers.constants.HashZero],
          [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
        const { success, error } = parseRelayReceipt(txReceipt);
        assert.isFalse(success);
        assert.equal(error, "BT: Forbidden contract");
      });
    });
  });

  describe("Approve token and Contract call", () => {
    describe("Approved by 1 EOA and 2 smart-contract guardians", () => {
      const amountToApprove = 10000;

      beforeEach(async () => {
        contract = await TestContract.new();
        assert.equal(await contract.state(), 0, "initial contract state should be 0");
        await addGuardians([...(await createSmartContractGuardians([guardian2, guardian3]))]);
      });

      describe("Invalid Target", () => {
        async function expectFailingApproveTokenAndCallContract(target) {
          const invalidData = contract.contract.methods.setStateAndPayToken(2, erc20.address, amountToApprove).encodeABI();
          const txReceipt = await manager.relay(wallet, "approveTokenAndCallContractApproved",
            [erc20.address, wallet.address, amountToApprove, target.address, invalidData],
            [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
          const { success, error } = parseRelayReceipt(txReceipt);
          assert.isFalse(success);
          assert.equal(error, "BT: Forbidden contract");
        }

        it.skip("should revert when target contract is the wallet", async () => {
          await expectFailingApproveTokenAndCallContract(wallet);
        });

        it.skip("should revert when target contract is an authorised module", async () => {
          await expectFailingApproveTokenAndCallContract(approvedTransfer);
        });
      });

      describe("Valid Target", () => {
        async function approveTokenAndCallContractApproved(_signers, _consumerAddress = contract.address, _wrapEth = false) {
          const newState = parseInt((await contract.state()).toString(), 10) + 1;
          const token = _wrapEth ? weth : erc20;
          const fun = _consumerAddress === contract.address ? "setStateAndPayToken" : "setStateAndPayTokenWithConsumer";
          const data = contract.contract.methods[fun](newState, token.address, amountToApprove).encodeABI();
          const before = await token.balanceOf(contract.address);
          const params = (_wrapEth ? [] : [erc20.address])
            .concat([_consumerAddress, amountToApprove, contract.address, data]);
          const method = _wrapEth ? "approveWethAndCallContractApproved" : "approveTokenAndCallContractApproved";
          await manager.relay(
            wallet,
            method,
            params,
            _signers,
          );
          const after = await token.balanceOf(contract.address);
          assert.equal(after.sub(before).toNumber(), amountToApprove, "should have approved and transfered the token amount");
          assert.equal((await contract.state()).toNumber(), newState, "the state of the external contract should have been changed");
        }

        it("should approve token for a spender then call a contract with 3 guardians, spender = contract", async () => {
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian3])]);
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian2, guardian3])]);
        });

        it("should approve WETH for a spender then call a contract with 3 guardians, spender = contract", async () => {
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian2])], contract.address, true);
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian3])], contract.address, true);
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian2, guardian3])], contract.address, true);
        });

        it("should approve token for a spender then call a contract with 3 guardians, spender != contract", async () => {
          const consumer = await contract.tokenConsumer();
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian2])], consumer);
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian1, guardian3])], consumer);
          await approveTokenAndCallContractApproved([owner, ...utils.sortWalletByAddress([guardian2, guardian3])], consumer);
        });

        it("should restore the original approved amount", async () => {
          const consumer = await contract.tokenConsumer();
          const allowanceBefore = await erc20.allowance(wallet.address, consumer);
          const balanceBefore = await erc20.balanceOf(contract.address);

          const dataToTransfer = contract.contract.methods.setStateAndPayTokenWithConsumer(2, erc20.address, amountToApprove).encodeABI();
          await manager.relay(wallet, "approveTokenAndCallContractApproved",
            [erc20.address, consumer, amountToApprove, contract.address, dataToTransfer],
            [owner, ...utils.sortWalletByAddress([guardian1, guardian2])]);

          const balanceAfter = await erc20.balanceOf(contract.address);
          assert.equal(balanceAfter.sub(balanceBefore).toNumber(), amountToApprove, "should have approved and transfered the token amount");
          assert.equal((await contract.state()).toNumber(), 2, "the state of the external contract should have been changed");

          const allowanceAfter = await erc20.allowance(wallet.address, consumer);
          assert.equal(allowanceAfter.toNumber(), allowanceBefore.toNumber());
        });
      });
    });
  });

  describe.skip("Daily Limit", () => {
    beforeEach(async () => {
      await wallet.setLimitAndDailySpent(1000000, 500);
    });

    it("should change the limit immediately", async () => {
      let limit = await wallet.getLimit();
      assert.equal(limit.toNumber(), 1000000, "limit should be 1000000");
      await manager.relay(wallet, "changeLimitApproved", [4000000], [owner, guardian1]);
      limit = await wallet.getLimit();
      assert.equal(limit.toNumber(), 4000000, "limit should be changed immediately");
    });

    it("should reset the daily consumption", async () => {
      let dailySpent = await wallet.getDailySpent();
      assert.equal(dailySpent.toNumber(), 500, "dailySpent should be 500");
      await manager.relay(wallet, "resetDailySpent", [], [owner, guardian1]);
      dailySpent = await wallet.getDailySpent();
      assert.equal(dailySpent.toNumber(), 0, "dailySpent should be 0");
    });

    it("should reset the daily consumption after a transfer", async () => {
      let dailySpent = await wallet.getDailySpent();
      assert.equal(dailySpent.toNumber(), 500, "dailySpent should be 500");
      await transferTokenApproved(utils.ETH_TOKEN, [owner, guardian1]);
      dailySpent = await wallet.getDailySpent();
      assert.equal(dailySpent.toNumber(), 0, "dailySpent should be 0");
    });

    it("should reset the daily consumption after a call contract", async () => {
      let dailySpent = await wallet.getDailySpent();
      assert.equal(dailySpent.toNumber(), 500, "dailySpent should be 500");
      await callContractApproved([owner, guardian1]);
      dailySpent = await wallet.getDailySpent();
      assert.equal(dailySpent.toNumber(), 0, "dailySpent should be 0");
    });
  });
});
