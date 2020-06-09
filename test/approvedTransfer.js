/* global accounts */
const ethers = require("ethers");

const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const GuardianStorage = require("../build/GuardianStorage");
const GuardianManager = require("../build/GuardianManager");
const ApprovedTransfer = require("../build/ApprovedTransfer");
const TokenPriceProvider = require("../build/TokenPriceProvider");
const ERC20 = require("../build/TestERC20");
const TestContract = require("../build/TestContract");

const TestManager = require("../utils/test-manager");
const { sortWalletByAddress, parseRelayReceipt, ETH_TOKEN } = require("../utils/utilities.js");

const DECIMALS = 12; // number of decimal for TOKN contract
const TOKEN_RATE = 51 * 10 ** 13; // 1 TOKN = 0.00051 ETH

const ZERO_BYTES32 = ethers.constants.HashZero;

const WRONG_SIGNATURE_NUMBER_REVERT_MSG = "RM: Wrong number of signatures";
const INVALID_SIGNATURES_REVERT_MSG = "RM: Invalid signatures";

describe("Approved Transfer", function () {
  this.timeout(10000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const guardian1 = accounts[2].signer;
  const guardian2 = accounts[3].signer;
  const guardian3 = accounts[4].signer;
  const recipient = accounts[5].signer;

  let deployer;
  let wallet;
  let guardianManager;
  let approvedTransfer;
  let priceProvider;
  let erc20;
  const amountToTransfer = 10000;

  before(async () => {
    deployer = manager.newDeployer();
    const registry = await deployer.deploy(Registry);
    const guardianStorage = await deployer.deploy(GuardianStorage);
    priceProvider = await deployer.deploy(TokenPriceProvider);
    await priceProvider.addManager(infrastructure.address);
    guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
    approvedTransfer = await deployer.deploy(ApprovedTransfer, {}, registry.contractAddress, guardianStorage.contractAddress);
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [approvedTransfer.contractAddress, guardianManager.contractAddress]);
    erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await priceProvider.setPrice(erc20.contractAddress, TOKEN_RATE);
    await infrastructure.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
  });

  async function addGuardians(guardians) {
    // guardians can be Wallet or ContractWrapper objects
    const guardianAddresses = guardians.map((guardian) => {
      if (guardian.address) return guardian.address;
      return guardian.contractAddress;
    });

    for (const address of guardianAddresses) {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, address);
    }

    await manager.increaseTime(30);
    for (let i = 1; i < guardianAddresses.length; i += 1) {
      await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardianAddresses[i]);
    }
    const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
    assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
  }

  async function createSmartContractGuardians(guardians) {
    const wallets = [];
    for (const g of guardians) {
      const guardianWallet = await deployer.deploy(Wallet);
      await guardianWallet.init(g.address, [guardianManager.contractAddress]);
      wallets.push(guardianWallet);
    }
    return wallets;
  }

  describe("Transfer", () => {
    async function transferToken(_token, _signers) {
      const to = recipient.address;
      const before = _token === ETH_TOKEN ? await deployer.provider.getBalance(to) : await erc20.balanceOf(to);
      await manager.relay(approvedTransfer, "transferToken",
        [wallet.contractAddress, _token, to, amountToTransfer, ZERO_BYTES32], wallet, _signers);
      const after = _token === ETH_TOKEN ? await deployer.provider.getBalance(to) : await erc20.balanceOf(to);
      assert.equal(after.sub(before).toNumber(), amountToTransfer, "should have transfered the amount");
    }

    async function expectFailingTransferToken(_token, _signers, _reason) {
      await assert.revertWith(
        manager.relay(
          approvedTransfer,
          "transferToken",
          [wallet.contractAddress, _token, recipient.address, amountToTransfer, ZERO_BYTES32],
          wallet,
          _signers,
        ), _reason,
      );
    }

    describe("Approved by EOA guardians", () => {
      describe("1 guardian", () => {
        beforeEach(async () => {
          await addGuardians([guardian1]);
        });
        it("should transfer ETH with 1 confirmation for 1 guardian", async () => {
          await transferToken(ETH_TOKEN, [owner, guardian1]);
        });
        it("should fail to transfer ETH when signer is not a guardian", async () => {
          await expectFailingTransferToken(ETH_TOKEN, [owner, guardian2], INVALID_SIGNATURES_REVERT_MSG);
        });
        it("should transfer ERC20 with 1 confirmation for 1 guardian", async () => {
          await transferToken(erc20.contractAddress, [owner, guardian1]);
        });
      });
      describe("2 guardians", () => {
        beforeEach(async () => {
          await addGuardians([guardian1, guardian2]);
        });
        it("should transfer ETH with 1 confirmation for 2 guardians", async () => {
          await transferToken(ETH_TOKEN, [owner, guardian1]);
        });
      });
      describe("3 guardians", () => {
        beforeEach(async () => {
          await addGuardians([guardian1, guardian2, guardian3]);
        });
        it("should not transfer ETH with 1 confirmation for 3 guardians", async () => {
          await expectFailingTransferToken(ETH_TOKEN, [owner, guardian1], WRONG_SIGNATURE_NUMBER_REVERT_MSG);
        });
        it("should transfer ETH with 2 confirmations for 3 guardians", async () => {
          await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        });
        it("should fail to transfer ERC20 with 1 confirmation for 3 guardians", async () => {
          await expectFailingTransferToken(erc20.contractAddress, [owner, guardian1], WRONG_SIGNATURE_NUMBER_REVERT_MSG);
        });
        it("should transfer ERC20 with 2 confirmations for 3 guardians", async () => {
          await transferToken(erc20.contractAddress, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        });
      });
    });

    describe("Approved by smart-contract guardians", () => {
      describe("1 guardian", () => {
        beforeEach(async () => {
          await addGuardians(await createSmartContractGuardians([guardian1]));
        });
        it("should transfer ETH with 1 confirmation for 1 guardian", async () => {
          await transferToken(ETH_TOKEN, [owner, guardian1]);
        });
        it("should transfer ERC20 with 1 confirmation for 1 guardian", async () => {
          await transferToken(erc20.contractAddress, [owner, guardian1]);
        });
      });
      describe("2 guardians", () => {
        beforeEach(async () => {
          await addGuardians(await createSmartContractGuardians([guardian1, guardian2]));
        });
        it("should transfer ETH with 1 confirmation for 2 guardians", async () => {
          await transferToken(ETH_TOKEN, [owner, guardian1]);
        });
      });
      describe("3 guardians", () => {
        beforeEach(async () => {
          await addGuardians(await createSmartContractGuardians([guardian1, guardian2, guardian3]));
        });
        it("should not transfer ETH with 1 confirmation for 3 guardians", async () => {
          await expectFailingTransferToken(ETH_TOKEN, [owner, guardian1], WRONG_SIGNATURE_NUMBER_REVERT_MSG);
        });
        it("should transfer ETH with 2 confirmations for 3 guardians", async () => {
          await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        });
        it("should not transfer ERC20 with 1 confirmations for 3 guardians", async () => {
          await expectFailingTransferToken(erc20.contractAddress, [owner, guardian1], WRONG_SIGNATURE_NUMBER_REVERT_MSG);
        });
        it("should transfer ERC20 with 2 confirmations for 3 guardians", async () => {
          await transferToken(erc20.contractAddress, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        });
      });
    });

    describe("Approved by EOA and smart-contract guardians", () => {
      it("should transfer ETH with 1 EOA guardian and 2 smart-contract guardians", async () => {
        await addGuardians([guardian1, ...(await createSmartContractGuardians([guardian2, guardian3]))]);
        await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian1, guardian3])]);
        await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian2, guardian3])]);
      });
      it("should transfer ETH with 2 EOA guardians and 1 smart-contract guardian", async () => {
        await addGuardians([guardian1, guardian2, ...await createSmartContractGuardians([guardian3])]);
        await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian1, guardian3])]);
        await transferToken(ETH_TOKEN, [owner, ...sortWalletByAddress([guardian2, guardian3])]);
      });
    });
  });

  describe("Contract call", () => {
    describe("Approved by 1 EOA and 2 smart-contract guardians", () => {
      let contract;

      beforeEach(async () => {
        contract = await deployer.deploy(TestContract);
        assert.equal(await contract.state(), 0, "initial contract state should be 0");
        await addGuardians([guardian1, ...(await createSmartContractGuardians([guardian2, guardian3]))]);
      });

      async function callContract(_signers) {
        const before = await deployer.provider.getBalance(contract.contractAddress);
        const newState = parseInt((await contract.state()).toString(), 10) + 1;
        const dataToTransfer = contract.contract.interface.functions.setState.encode([newState]);
        await manager.relay(approvedTransfer, "callContract",
          [wallet.contractAddress, contract.contractAddress, amountToTransfer, dataToTransfer], wallet, _signers);
        const after = await deployer.provider.getBalance(contract.contractAddress);
        assert.equal(after.sub(before).toNumber(), amountToTransfer, "should have transfered the ETH amount");
        assert.equal((await contract.state()).toNumber(), newState, "the state of the external contract should have been changed");
      }

      it("should call a contract and transfer ETH with 1 EOA guardian and 2 smart-contract guardians", async () => {
        await callContract([owner, ...sortWalletByAddress([guardian1, guardian2])]);
        await callContract([owner, ...sortWalletByAddress([guardian1, guardian3])]);
        await callContract([owner, ...sortWalletByAddress([guardian2, guardian3])]);
      });

      it("should not be able to call the wallet itself", async () => {
        const txReceipt = await manager.relay(approvedTransfer, "callContract",
          [wallet.contractAddress, wallet.contractAddress, amountToTransfer, ethers.constants.HashZero],
          wallet,
          [owner, ...sortWalletByAddress([guardian1, guardian2])]);
        const { success, error } = parseRelayReceipt(txReceipt);
        assert.isFalse(success);
        assert.equal(error, "AT: Forbidden contract");
      });
    });
  });

  describe("Approve token and Contract call", () => {
    describe("Approved by 1 EOA and 2 smart-contract guardians", () => {
      let contract;
      const amountToApprove = 10000;

      beforeEach(async () => {
        contract = await deployer.deploy(TestContract);
        assert.equal(await contract.state(), 0, "initial contract state should be 0");
        await addGuardians([guardian1, ...(await createSmartContractGuardians([guardian2, guardian3]))]);
      });

      describe("Invalid Target", () => {
        async function expectFailingApproveTokenAndCallContract(target) {
          const invalidData = contract.contract.interface.functions.setStateAndPayToken.encode([2, erc20.contractAddress, amountToApprove]);
          const txReceipt = await manager.relay(approvedTransfer, "approveTokenAndCallContract",
            [wallet.contractAddress, erc20.contractAddress, wallet.contractAddress, amountToApprove, target.contractAddress, invalidData],
            wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
          const { success, error } = parseRelayReceipt(txReceipt);
          assert.isFalse(success);
          assert.equal(error, "AT: Forbidden contract");
        }

        it("should revert when target contract is the wallet", async () => {
          await expectFailingApproveTokenAndCallContract(wallet);
        });

        it("should revert when target contract is an authorised module", async () => {
          await expectFailingApproveTokenAndCallContract(approvedTransfer);
        });
      });

      describe("Valid Target", () => {
        async function approveTokenAndCallContract(_signers, _consumerAddress = contract.contractAddress) {
          const newState = parseInt((await contract.state()).toString(), 10) + 1;
          const fun = _consumerAddress === contract.contractAddress ? "setStateAndPayToken" : "setStateAndPayTokenWithConsumer";
          const data = contract.contract.interface.functions[fun].encode(
            [newState, erc20.contractAddress, amountToApprove],
          );
          const before = await erc20.balanceOf(contract.contractAddress);
          await manager.relay(
            approvedTransfer,
            "approveTokenAndCallContract",
            [wallet.contractAddress, erc20.contractAddress, _consumerAddress, amountToApprove, contract.contractAddress, data],
            wallet,
            _signers,
          );
          const after = await erc20.balanceOf(contract.contractAddress);
          assert.equal(after.sub(before).toNumber(), amountToApprove, "should have approved and transfered the token amount");
          assert.equal((await contract.state()).toNumber(), newState, "the state of the external contract should have been changed");
        }

        it("should approve token for a spender then call a contract with 3 guardians, spender = contract", async () => {
          await approveTokenAndCallContract([owner, ...sortWalletByAddress([guardian1, guardian2])]);
          await approveTokenAndCallContract([owner, ...sortWalletByAddress([guardian1, guardian3])]);
          await approveTokenAndCallContract([owner, ...sortWalletByAddress([guardian2, guardian3])]);
        });

        it("should approve token for a spender then call a contract with 3 guardians, spender != contract", async () => {
          const consumer = await contract.tokenConsumer();
          await approveTokenAndCallContract([owner, ...sortWalletByAddress([guardian1, guardian2])], consumer);
          await approveTokenAndCallContract([owner, ...sortWalletByAddress([guardian1, guardian3])], consumer);
          await approveTokenAndCallContract([owner, ...sortWalletByAddress([guardian2, guardian3])], consumer);
        });

        it("should restore the original approved amount", async () => {
          const consumer = await contract.tokenConsumer();
          const allowanceBefore = await erc20.allowance(wallet.contractAddress, consumer);
          const balanceBefore = await erc20.balanceOf(contract.contractAddress);

          const dataToTransfer = contract.contract.interface.functions
            .setStateAndPayTokenWithConsumer.encode([2, erc20.contractAddress, amountToApprove]);
          await manager.relay(approvedTransfer, "approveTokenAndCallContract",
            [wallet.contractAddress, erc20.contractAddress, consumer, amountToApprove, contract.contractAddress, dataToTransfer],
            wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);

          const balanceAfter = await erc20.balanceOf(contract.contractAddress);
          assert.equal(balanceAfter.sub(balanceBefore).toNumber(), amountToApprove, "should have approved and transfered the token amount");
          assert.equal((await contract.state()).toNumber(), 2, "the state of the external contract should have been changed");

          const allowanceAfter = await erc20.allowance(wallet.contractAddress, consumer);
          assert.equal(allowanceAfter.toNumber(), allowanceBefore.toNumber());
        });
      });
    });
  });
});
