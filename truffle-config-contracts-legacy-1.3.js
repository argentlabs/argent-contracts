const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "contracts-legacy/v1.3.0",
  contracts_build_directory: "build-legacy/v1.3.0",

  compilers: {
    solc: {
      version: "0.5.4",
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
