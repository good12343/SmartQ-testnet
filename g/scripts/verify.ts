import { ethers, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main(): Promise<void> {
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error("ETHERSCAN_API_KEY غير موجود في .env");
  }

  // ─── العناوين النهائية ──────────────────────────────────────────────
  const timelockAddress = "0x3c89FBd2867E2c0974149ba9c5f7472DCbe2A5e1";
  const oracleAddress   = "0x2c0D06d73fAdB02E1c38a1a3e8159d8b34De6A00";
  const tokenAddress    = "0x75dABB2A0CE5919a0BD6764d67e320d3Dc11b74E";
  const vestingAddress  = "0xd147EC22Ef57aF0B57e684cdD6237a529fe2F9AD";
  const airdropAddress  = "0xdF21eD6190dd47848FE8C5d97112e7302CA8F3B0";
  const saleAddress     = "0x9427A42445fF06EF4F25285CEA7212e928c8FA13";

  const deployerAddress = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";
  const TREASURY_WALLET = deployerAddress;

  // ─── قراءة القيم المخزنة لـ Constructor Args ─────────────────────────
  const vesting = await ethers.getContractAt("Vesting", vestingAddress);
  const startTime = await vesting.startTime();

  const sale = await ethers.getContractAt("Sale", saleAddress);
  const saleCap = await sale.saleCap();
  const walletCap = await sale.walletCap();
  const minPurchase = await sale.minPurchase();
  const saleStart = await sale.saleStart();
  const saleEnd = await sale.saleEnd();

  // ─── تعريف وسائط النشر ──────────────────────────────────────────────
  const timelockArgs = [
    300,
    [deployerAddress],
    [deployerAddress],
    deployerAddress
  ];

  const oracleArgs = [deployerAddress];

  const TOKEN_NAME = "Token For";
  const TOKEN_SYMBOL = "For";
  const TREASURY_AMOUNT = ethers.parseEther("400000000");
  const VESTING_AMOUNT  = ethers.parseEther("300000000");
  const AIRDROP_AMOUNT  = ethers.parseEther("100000000");
  const SALE_AMOUNT     = ethers.parseEther("200000000");

  const tokenArgs = [
    TOKEN_NAME,
    TOKEN_SYMBOL,
    timelockAddress,
    TREASURY_WALLET,
    vestingAddress,
    airdropAddress,
    saleAddress,
    TREASURY_AMOUNT,
    VESTING_AMOUNT,
    AIRDROP_AMOUNT,
    SALE_AMOUNT
  ];

  const vestingArgs = [
    tokenAddress,
    TREASURY_WALLET,
    deployerAddress,
    startTime
  ];

  const airdropArgs = [
    tokenAddress,
    vestingAddress,
    TREASURY_WALLET,
    timelockAddress
  ];

  const saleArgs = [
    tokenAddress,
    vestingAddress,
    oracleAddress,
    TREASURY_WALLET,
    deployerAddress,
    saleCap,
    walletCap,
    minPurchase,
    saleStart,
    saleEnd
  ];

  // ─── التحقق من جميع العقود ──────────────────────────────────────────
  console.log("🔍 Verifying Timelock...");
  await run("verify:verify", {
    address: timelockAddress,
    constructorArguments: timelockArgs,
  });

  console.log("🔍 Verifying Oracle...");
  await run("verify:verify", {
    address: oracleAddress,
    constructorArguments: oracleArgs,
  });

  console.log("🔍 Verifying Token...");
  await run("verify:verify", {
    address: tokenAddress,
    constructorArguments: tokenArgs,
  });

  console.log("🔍 Verifying Vesting...");
  await run("verify:verify", {
    address: vestingAddress,
    constructorArguments: vestingArgs,
  });

  console.log("🔍 Verifying Airdrop...");
  await run("verify:verify", {
    address: airdropAddress,
    constructorArguments: airdropArgs,
  });

  console.log("🔍 Verifying Sale...");
  await run("verify:verify", {
    address: saleAddress,
    constructorArguments: saleArgs,
  });

  console.log("\n✅ جميع العقود تم توثيقها بنجاح!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});