const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts-legacy/v2.4.0",
  contracts_build_directory: "build-legacy/v2.4.0",

  compilers: {
    solc: {
      version: "0.6.12",
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
