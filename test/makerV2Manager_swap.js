const { AddressZero } = require("ethers").constants;
const { WAD } = require("../utils/utilities.js");
const { deployMaker } = require("../utils/defi-deployer");
const TestManager = require("../utils/test-manager");
const MakerV2Invest = require("../build/TestMakerV2Invest");
const Wallet = require("../build/BaseWallet");
const GuardianStorage = require("../build/GuardianStorage");

const DAI_SENT = WAD.div(100000000);

/* global accounts */
describe("MakerV2 SAI<>DAI", function () {
  this.timeout(100000);

  const manager = new TestManager();
  const { deployer } = manager;

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;

  let wallet;
  let makerV2;
  let sai;
  let dai;


  before(async () => {
    const m = await deployMaker(deployer, infrastructure);
    [sai, dai] = [m.sai, m.dai];
    const { migration, pot } = m;

    const guardianStorage = await deployer.deploy(GuardianStorage);
    makerV2 = await deployer.deploy(
      MakerV2Invest,
      {},
      AddressZero,
      guardianStorage.contractAddress,
      migration.contractAddress,
      pot.contractAddress,
      { gasLimit: 8000000 },
    );
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [makerV2.contractAddress]);
    await sai["mint(address,uint256)"](wallet.contractAddress, DAI_SENT.mul(20));
    await dai["mint(address,uint256)"](wallet.contractAddress, DAI_SENT.mul(20));
  });

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
