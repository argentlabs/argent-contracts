const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts/modules",

  compilers: {
    solc: {
      version: "0.7.4",
      docker: false,
      settings: {
        optimizer: {
          enabled: true,
          runs: 400,
        },
      },
    },
  },
};
