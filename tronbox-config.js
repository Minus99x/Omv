export default {
  contracts_directory: './contracts',
  contracts_build_directory: './build/tron',
  build_info_directory: './build/tron-info',
  compilers: {
    solc: {
      version: '0.8.31',
      settings: {
        optimizer: { enabled: true, runs: 200 }
      }
    }
  }
};
