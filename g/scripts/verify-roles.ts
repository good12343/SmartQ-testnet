//التحقق من التنفيذ
import { ethers } from "hardhat";

async function main() {
  const VESTING = "0x5005683d28837692069b042D7277Ff7CEb6636F0";
  const SALE = "0x07990E955001b7099B22dA37594542d85FD2c624";
  const AIRDROP = "0x99A9bD1bb7d441adE84eD412549C2b61F3DF2B44";

  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));

  const vesting = await ethers.getContractAt(
    ["function hasRole(bytes32 role, address account) view returns (bool)"],
    VESTING
  );

  const saleHas = await vesting.hasRole(DEPOSITOR_ROLE, SALE);
  const airdropHas = await vesting.hasRole(DEPOSITOR_ROLE, AIRDROP);

  console.log("Sale has DEPOSITOR_ROLE:", saleHas ? "✅ YES" : "❌ NO");
  console.log("Airdrop has DEPOSITOR_ROLE:", airdropHas ? "✅ YES" : "❌ NO");

  if (saleHas && airdropHas) {
    console.log("\n🎉 الأدوار ممنوحة بالكامل");
  } else {
    console.log("\n⚠️ شيء ما غير صحيح");
  }
}

main().catch(console.error);