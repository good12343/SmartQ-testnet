// scripts/execute.ts
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const DEPLOYMENTS_DIR = path.join(process.cwd(), "deployments");

function loadJson(name: string) {
  const file = path.join(DEPLOYMENTS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`${file} غير موجود`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const governancePk = process.env.GOVERNANCE_PRIVATE_KEY!;
  const deployerPk = process.env.PRIVATE_KEY!;
  const governanceSigner = new ethers.Wallet(governancePk, ethers.provider);
  const deployer = new ethers.Wallet(deployerPk, ethers.provider);

  console.log("=".repeat(80));
  console.log("🚀 المرحلة 2 – تنفيذ الاقتراحات");
  console.log("الشبكة:", network.name);
  console.log("الحوكمة:", governanceSigner.address);
  console.log("الناشر:", deployer.address);
  console.log("=".repeat(80));

  const dep = loadJson("sepolia");
  const pendingData = loadJson("pending-actions");
  const pending = pendingData.actions;
  if (!pending || pending.length === 0) throw new Error("لا توجد اقتراحات للتنفيذ");

  const TokenABI = (await ethers.getContractFactory("Token")).interface;
  const VestingABI = (await ethers.getContractFactory("Vesting")).interface;
  const SaleABI = (await ethers.getContractFactory("Sale")).interface;
  const AirdropABI = (await ethers.getContractFactory("Airdrop")).interface;

  const getContract = (addr: string, abi: any) =>
    new ethers.Contract(addr, abi, governanceSigner);

  // تنفيذ كل الاقتراحات
  for (const p of pending) {
    const abi = p.meta.contract === "Token" ? TokenABI :
                p.meta.contract === "Vesting" ? VestingABI :
                p.meta.contract === "Sale" ? SaleABI : AirdropABI;
    const contract = getContract(p.contractAddress, abi);
    console.log(`⚙️  ${p.label} (${p.actionId})...`);
    const tx = await contract.executeAction(p.actionId);
    await tx.wait();
    console.log(`✅ ${p.label} تم`);
  }

  // تحويل الـ 600M
  const total = ethers.parseEther("600000000");
  const token = new ethers.Contract(dep.Token, TokenABI, deployer);
  console.log(`\n💰 تحويل ${ethers.formatEther(total)} إلى Vesting...`);
  const tx = await token.transfer(dep.Vesting, total);
  await tx.wait();
  console.log("✅ تم التحويل");

  console.log("\n🎉 اكتمل كل شيء!");
}

main().catch((e) => { console.error(e); process.exit(1); });