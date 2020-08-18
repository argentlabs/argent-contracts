/* global artifacts */
const MultiSigWallet = artifacts.require("MultiSigWallet");
const TestRegistry = artifacts.require("TestRegistry");

const MultisigExecutor = require("../utils/multisigexecutor.js");
const utilities = require("../utils/utilities.js");

contract("MultiSigWallet", (accounts) => {
  const owner = accounts[0];
  const owner1 = accounts[1];
  const owner2 = accounts[2];
  const owner3 = accounts[3];
  const newowner = accounts[4];

  let multisig;
  let reg;
  let value;
  let number;
  let owners;

  before(async () => {
    number = 12345;
    value = 10000000000;
    owners = utilities.sortWalletByAddress([owner1, owner2, owner3]);
  });

  beforeEach(async () => {
    multisig = await MultiSigWallet.new(2, owners);

    reg = await TestRegistry.new();

    // Fund the multisig
    await multisig.send(value);

    const bal = await utilities.getBalance(multisig.address);
    assert.equal(bal.toNumber(), value);
  });

  async function getSignatures(signedData, signers, sortSigners = true, returnBadSignatures = false) {
    // Sort the signers
    let sortedSigners = signers;
    if (sortSigners) {
      sortedSigners = utilities.sortWalletByAddress(signers);
    }
    const signHashBuffer = Buffer.from(signedData.slice(2), "hex");
    let signatures = "0x";

    for (const signer of sortedSigners) {
      let sig = await signer.signMessage(signHashBuffer);
      if (returnBadSignatures) {
        sig += "a1";
      }
      signatures += sig.slice(2);
    }
    return signatures;
  }

  async function executeSendSuccess(signers) {
    let nonce = await multisig.nonce();
    const data = reg.contract.methods.register([number]).encodeABI();
    const signedData = MultisigExecutor.signHash(multisig.address, reg.address, value, data, nonce.toNumber());
    const signatures = await getSignatures(signedData, signers);

    await multisig.execute(reg.address, value, data, signatures);

    // Check that number has been set in registry
    const numFromRegistry = await reg.registry(multisig.address);
    assert.equal(numFromRegistry.toNumber(), number);

    // Check funds in registry
    const bal = await utilities.getBalance(reg.address);
    assert.equal(bal.toString(), value.toString());

    // Check nonce updated
    nonce = await multisig.nonce();
    assert.equal(nonce.toNumber(), 1);
  }

  async function executeSendFailure(signers, nonceOffset, sortSigners, returnBadSignatures, errorMessage) {
    let nonce = await multisig.nonce();
    nonce = nonce.toNumber() + nonceOffset;
    const data = reg.contract.methods.register([number]).encodeABI();

    const signedData = MultisigExecutor.signHash(multisig.address, reg.address, value, data, nonce);
    const signatures = await getSignatures(signedData, signers, sortSigners, returnBadSignatures);

    await utilities.assertRevert(multisig.execute(reg.address, value, data, signatures), errorMessage);
  }

  async function getMultiSigParams(functioName, params) {
    const nonce = await multisig.nonce();
    const data = multisig.contract.methods[functioName]([...params]).encodeABI;
    const signedData = MultisigExecutor.signHash(multisig.address, multisig.address, 0, data, nonce.toNumber());
    const signatures = await getSignatures(signedData, [owner1, owner2]);
    return { data, signatures };
  }

  describe("Creating and changing the multisig", () => {
    it("should not be able to instantiate without owners", async () => {
      await utilities.assertRevert(MultiSigWallet.new(2, []), "MSW: Not enough or too many owners");
    });

    it("should not be able to instantiate with 0 threshold", async () => {
      await utilities.assertRevert(MultiSigWallet.new(0, owners), "MSW: Invalid threshold");
    });

    it("should store owners correctly", async () => {
      for (let i = 0; i < 3; i += 1) {
        const isOwner = await multisig.isOwner(owners[i]);
        assert.isTrue(isOwner);
      }

      const ownersCount = await multisig.ownersCount();
      assert.equal(ownersCount.toNumber(), 3);
    });

    it("should have initial nonce of zero", async () => {
      const nonce = await multisig.nonce();
      assert.equal(nonce.toNumber(), 0);
    });

    it("should not be able to execute addOwner externally", async () => {
      await utilities.assertRevert(multisig.addOwner(newowner), "MSW: Calling account is not wallet");
    });

    it("should not be able to execute removeOwner externally", async () => {
      await utilities.assertRevert(multisig.removeOwner(newowner), "MSW: Calling account is not wallet");
    });

    it("should not be able to execute changeThreshold externally", async () => {
      await utilities.assertRevert(multisig.changeThreshold(15), "MSW: Calling account is not wallet");
    });

    it("should be able to add new owner", async () => {
      const { data, signatures } = await getMultiSigParams("addOwner", [newowner]);
      await multisig.execute(multisig.address, 0, data, signatures);

      const isOwner = await multisig.isOwner(newowner);
      assert.isTrue(isOwner);
    });

    it("should not be able to add more than 10 owners", async () => {
      // We already have 3 owners, which are accounts 1..3
      // Here we add accounts 4..10 to get 10 owners on the multisig
      for (let i = 4; i <= 10; i += 1) {
        const randomAddress = await utilities.getRandomAddress();
        const { data, signatures } = await getMultiSigParams("addOwner", [randomAddress]);
        await multisig.execute(multisig.address, 0, data, signatures);
      }

      const ownersCount = await multisig.ownersCount();
      assert.equal(ownersCount.toNumber(), 10);

      const randomAddress = await utilities.getRandomAddress();
      const { data, signatures } = await getMultiSigParams("addOwner", [randomAddress]);
      await utilities.assertRevert(multisig.execute(multisig.address, 0, data, signatures), "MSW: External call failed");
    });

    it("should not be able to add owner twice", async () => {
      const { data, signatures } = await getMultiSigParams("addOwner", [owner1]);
      await utilities.assertRevert(multisig.execute(multisig.address, 0, data, signatures), "MSW: External call failed");
    });

    it("should be able to remove existing owner", async () => {
      const { data, signatures } = await getMultiSigParams("removeOwner", [owner1]);
      await multisig.execute(multisig.address, 0, data, signatures);

      const isOwner = await multisig.isOwner(owner1);
      assert.isFalse(isOwner);
    });

    it("should not be able to remove owner if remaining owners are at the threshold count", async () => {
      const values1 = await getMultiSigParams("removeOwner", [owner3]);
      await multisig.execute(multisig.address, 0, values1.data, values1.signatures);

      const values2 = await getMultiSigParams("removeOwner", [owner2]);
      await utilities.assertRevert(multisig.execute(multisig.address, 0, values2.data, values2.signatures), "MSW: External call failed");
    });

    it("should not be able to remove a nonexisting owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
      const { data, signatures } = await getMultiSigParams("removeOwner", [randomAddress]);
      await utilities.assertRevert(multisig.execute(multisig.address, 0, data, signatures), "MSW: External call failed");
    });

    it("should be able to change the threshold", async () => {
      let threshold = await multisig.threshold();
      assert.equal(threshold.toNumber(), 2);

      const { data, signatures } = await getMultiSigParams("changeThreshold", [3]);
      await multisig.execute(multisig.address, 0, data, signatures);

      threshold = await multisig.threshold();
      assert.equal(threshold.toNumber(), 3);
    });

    it("should not be able to change the threshold to be more than the current number of owners", async () => {
      const { data, signatures } = await getMultiSigParams("changeThreshold", [4]);
      await utilities.assertRevert(multisig.execute(multisig.address, 0, data, signatures), "MSW: External call failed");
    });
  });

  describe("3 signers, threshold 2", () => {
    it("should succeed with signers 1, 2", async () => {
      await executeSendSuccess([owner1, owner2]);
    });

    it("should succeed with signers 1, 3", async () => {
      await executeSendSuccess([owner1, owner3]);
    });

    it("should succeed with signers 2, 3", async () => {
      await executeSendSuccess([owner2, owner3]);
    });

    it("should succeed with more signers than threshold", async () => {
      await executeSendSuccess([owner1, owner2, owner3]);
    });

    it("should fail due to non-owner signer", async () => {
      await executeSendFailure([owner, owner3], 0, "Not enough valid signatures");
    });

    it("should fail with fewer signers than threshold", async () => {
      await executeSendFailure([owner1], 0, "MSW: Not enough signatures");
    });

    it("should fail with one signer signing twice", async () => {
      await executeSendFailure([owner1, owner1], 0, true, "MSW: Badly ordered signatures");
    });

    it("should fail with signers in wrong order", async () => {
      let signers = utilities.sortWalletByAddress([owner1, owner2]);
      signers = signers.reverse(); // opposite order it should be
      await executeSendFailure(signers, 0, false, "MSW: Badly ordered signatures");
    });

    it("should fail with the wrong nonce", async () => {
      const nonceOffset = 1;
      await executeSendFailure([owner1, owner2], nonceOffset, true, "MSW: Not enough valid signatures");
    });

    it("should fail with the wrong signature", async () => {
      await executeSendFailure([owner1, owner2], 0, true, true, "MSW: Invalid v");
    });
  });
});
