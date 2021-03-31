const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts/modules",

  compilers: {
    solc: {
      version: "0.8.3",
      docker: false,
      settings: {
        optimizer: {
          enabled: true,
          runs: 300,
        },
      },
    },
  },
};
