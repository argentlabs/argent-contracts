const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts-legacy/v1.6.0",
  contracts_build_directory: "build-legacy/v1.6.0",

  compilers: {
    solc: {
      version: "0.5.4",
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
