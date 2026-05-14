import { ethers } from "hardhat";

async function main() {

  const timelockAddress = "0x00337C1B3424dd6dda3Ada4e66E31C412118AC13";

  const timelock = await ethers.getContractAt(
    "ProjectTimelock",
    timelockAddress
  );

  const role = await timelock.DEFAULT_ADMIN_ROLE();

  console.log("ROLE:", role);

  const multisig = "0x97C7585e5dF897E021A9fAf34cc3954eb81D3E1E";
  const deployer = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";

  console.log("Multisig has role:", await timelock.hasRole(role, multisig));
  console.log("Deployer has role:", await timelock.hasRole(role, deployer));
}

main().catch(console.error);