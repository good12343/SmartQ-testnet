//التحقق من التنفيذ
import { ethers } from "hardhat";

async function main() {
  const VESTING = "0xdCad47f73393fa98F67590E22459735A72873151";
  const SALE = "0x84993e4dfd406a8e7E315E5E42c4BE59F9427eae";
  const AIRDROP = "0xEd86751b9EB83Bd6669406C7F2ba5229548b71A9";

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