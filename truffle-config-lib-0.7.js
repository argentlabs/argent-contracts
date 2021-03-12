const baseConfig = require("./truffle-config.base.js");

module.exports = {
  ...baseConfig,
  contracts_directory: "lib_0.7",

  compilers: {
    solc: {
      version: "0.7.5",
      docker: true,
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },
};
