const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts/*.sol",

  compilers: {
    solc: {
      version: "0.8.3",
      docker: false,
      settings: {
        optimizer: {
          enabled: true,
          runs: 999,
        },
      },
    },
  },
};
