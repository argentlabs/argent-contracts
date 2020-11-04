/* globals artifacts */

const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const GuardianStorage = artifacts.require("GuardianStorage");

module.exports = (deployer, network) => {
  console.log(`## ${network} network ##`);
  deployer.deploy(
    ApprovedTransfer,
    "0x22Ce12a6dFCF7d67c3DbEF01B19707077b528223",
    "0x3bD35C298Ea89EfA0EF2dB208aB562E9e3F89DF4",
    "0x0479B49a95c6bF395F1fC7d0118b44c752C7c410",
    "0x0A1545B32D7cdea1EeD2fb259A82AcFE5e75962C",
    "0xc778417E063141139Fce010982780140Aa0cD5Ab");

  deployer.deploy(GuardianStorage);
};
