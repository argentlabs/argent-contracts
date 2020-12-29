const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts-test",

  compilers: {
    solc: {
      version: "0.7.4",
      docker: true,
      settings: {
        optimizer: {
          enabled: true,
          runs: 999,
        },
      },
    },
  },
};
