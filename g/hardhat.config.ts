import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";

import { HardhatUserConfig } from "hardhat/config";

// 🔐 قراءة المتغيرات من .env
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const ETH_RPC_URL = process.env.ETH_RPC_URL || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // 🧪 شبكة محلية
    hardhat: {
      chainId: 31337,
    },

    // 🌍 Ethereum Mainnet
    mainnet: {
      url: ETH_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 1,
    },
  },

  // ✅ إعدادات Etherscan Verify
  etherscan: {
      apiKey: ETHERSCAN_API_KEY,
    },
  };


export default config;