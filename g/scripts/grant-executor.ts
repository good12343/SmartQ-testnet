//اخذ الصلاحيات من تايم لووك الى EXECUTOR_ROLE
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const TIMELOCK = "0xCf1ad78B4f6C39271FB6Eb3d8A35f56b5D23480B"; // ضع العنوان الصحيح

  const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));

  const abi = [
    "function grantRole(bytes32 role, address account)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
  ];
  const timelock = new ethers.Contract(TIMELOCK, abi, deployer);

  if (await timelock.hasRole(EXECUTOR_ROLE, deployer.address)) {
    console.log("✅ لديك EXECUTOR_ROLE بالفعل");
    return;
  }

  console.log("⏳ منح EXECUTOR_ROLE...");
  const tx = await timelock.grantRole(EXECUTOR_ROLE, deployer.address);
  await tx.wait();
  console.log("✅ تم منح EXECUTOR_ROLE بنجاح");
}

main().catch(console.error);