const ArgentWalletDetector = require("../build/ArgentWalletDetector");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");

const TestManager = require("../utils/test-manager");

//const argentCode = "0x7899f8a5e2362ec6ae586d08ca7a344acd3122abf2d23c5df2a18d7a540dd500";
const randomCode = "0x880ac7547a884027b93f5eaba5ff545919fdeb3c23ed0d2094db66303b3a80ac";

describe("ArgentWalletDetector", () => {
  const manager = new TestManager();

  let deployer;
  let detector;
  let implementation1;
  let implementation2;
  let proxy1;
  let proxy2;
  let argentCode;

  before(async () => {
    deployer = manager.newDeployer();
    implementation1 = await deployer.deploy(BaseWallet);
    implementation2 = await deployer.deploy(BaseWallet);
    proxy1 = await deployer.deploy(Proxy, {}, implementation1.contractAddress);
    proxy2 = await deployer.deploy(Proxy, {}, implementation2.contractAddress);
    argentCode = ethers.utils.keccak256(proxy1._contract.deployedBytecode);
  });

  beforeEach(async () => {
    detector = await deployer.deploy(ArgentWalletDetector, {}, [], []);
  });

  describe("add info", () => {
    it("should deploy with codes and implementations", async () => {
      const c = [argentCode, randomCode];
      const i = [implementation1.contractAddress, implementation2.contractAddress];
      detector = await deployer.deploy(ArgentWalletDetector, {}, c, i);
      const implementations = await detector.getImplementations();
      assert.equal(implementations[0], implementation1.contractAddress, "should have added first implementation");
      assert.equal(implementations[1], implementation2.contractAddress, "should have added second implementation");
      const codes = await detector.getCodes();
      assert.equal(codes[0], argentCode, "should have added first code");
      assert.equal(codes[1], randomCode, "should have added second code");
    });

    it("should add implementations", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      await detector.addImplementation(implementation2.contractAddress);
      const implementations = await detector.getImplementations();
      assert.equal(implementations[0], implementation1.contractAddress, "should have added first implementation");
      assert.equal(implementations[1], implementation2.contractAddress, "should have added second implementation");
    });

    it("should add codes", async () => {
      await detector.addCode(argentCode);
      await detector.addCode(randomCode);
      const codes = await detector.getCodes();
      assert.equal(codes[0], argentCode, "should have added first code");
      assert.equal(codes[1], randomCode, "should have added second code");
    });

    it("should add code and implementation from a wallet", async () => {
      await detector.addCodeAndImplementationFromWallet(proxy1.contractAddress);
      const isArgent = await detector.isArgentWallet(proxy1.contractAddress);
      assert.isTrue(isArgent, "should return true for an Argent wallet");
    });

    it("should return false when the code is not correct", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      await detector.addCode(randomCode);
      const isArgent = await detector.isArgentWallet(proxy1.contractAddress);
      assert.isFalse(isArgent, "should return false when the code is not correct");
    });

    it("should return false when the implementation is not correct", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      await detector.addCode(argentCode);
      const isArgent = await detector.isArgentWallet(proxy2.contractAddress);
      assert.isFalse(isArgent, "should return false when the implementation is not correct");
    });
  });
});
