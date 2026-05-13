// تنفيذ الادوار فقط بدون انتظار Timelock 
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const TIMELOCK = "0x106628307cE23559c756C139c1A0EA39E5661FF6"; // عنوان Timelock
  const VESTING = "0x5005683d28837692069b042D7277Ff7CEb6636F0";  // عنوان Vesting
  const SALE = "0x07990E955001b7099B22dA37594542d85FD2c624";
  const AIRDROP = "0x99A9bD1bb7d441adE84eD412549C2b61F3DF2B44";

  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));

  const VESTING_ABI = [
    "function grantRole(bytes32 role, address account)",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ];
  const TIMELOCK_ABI = [
    "function execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)"
  ];

  const timelock = new ethers.Contract(TIMELOCK, TIMELOCK_ABI, deployer);
  const vesting = new ethers.Contract(VESTING, VESTING_ABI, deployer);

  const saleData = vesting.interface.encodeFunctionData("grantRole", [DEPOSITOR_ROLE, SALE]);
  const airdropData = vesting.interface.encodeFunctionData("grantRole", [DEPOSITOR_ROLE, AIRDROP]);

  console.log("🚀 تنفيذ Sale...");
  const tx1 = await timelock.execute(VESTING, 0, saleData, ethers.ZeroHash, ethers.ZeroHash);
  await tx1.wait();
  console.log("✅ Sale done");

  console.log("🚀 تنفيذ Airdrop...");
  const tx2 = await timelock.execute(VESTING, 0, airdropData, ethers.ZeroHash, ethers.ZeroHash);
  await tx2.wait();
  console.log("✅ Airdrop done");
}

main().catch(console.error);