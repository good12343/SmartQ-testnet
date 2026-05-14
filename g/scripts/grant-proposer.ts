//اعطى الصلاحيات من تايم لوك الى PROPOSER_ROLE
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const TIMELOCK = process.env.TIMELOCK_ADDRESS || "0xe1fe5Cf76BE0f9B2979896CffAA4232eAD127bE6";

  const PROPOSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE"));

  const timelockAbi = [
    "function grantRole(bytes32 role, address account)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
  ];
  const timelock = new ethers.Contract(TIMELOCK, timelockAbi, deployer);

  const hasRole = await timelock.hasRole(PROPOSER_ROLE, deployer.address);
  if (hasRole) {
    console.log("✅ أنت تملك PROPOSER_ROLE بالفعل");
    return;
  }

  console.log("⏳ منح PROPOSER_ROLE...");
  const tx = await timelock.grantRole(PROPOSER_ROLE, deployer.address);
  await tx.wait();
  console.log("✅ تم منح PROPOSER_ROLE بنجاح");
}

main().catch(console.error);