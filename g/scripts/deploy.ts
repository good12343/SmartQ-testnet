// scripts/deploy.ts
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const DEPLOYMENTS_DIR = path.join(process.cwd(), "deployments");

function ensureDir() {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
}

function saveJson(name: string, data: any) {
  ensureDir();
  fs.writeFileSync(path.join(DEPLOYMENTS_DIR, `${name}.json`), JSON.stringify(data, null, 2));
  console.log(`💾 تم حفظ ${name}.json`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const governancePk = process.env.GOVERNANCE_PRIVATE_KEY;
  if (!governancePk) throw new Error("GOVERNANCE_PRIVATE_KEY مطلوب");
  const governanceSigner = new ethers.Wallet(governancePk, ethers.provider);

  console.log("=".repeat(80));
  console.log("🚀 المرحلة 1 – نشر العقود + اقتراحات");
  console.log("الشبكة:", network.name);
  console.log("الناشر:", deployer.address);
  console.log("الحوكمة:", governanceSigner.address);
  console.log("=".repeat(80));

  const GOVERNANCE = governanceSigner.address;
  const TREASURY   = "0x54fdc4531400daa82c00b68c5c91db327abdf15c";

  const TOKEN_NAME   = "FREEPAL";
  const TOKEN_SYMBOL = "FREEPAL";

  const TREASURY_ALLOCATION = ethers.parseEther("400000000");
  const VESTING_ALLOCATION  = ethers.parseEther("300000000");
  const AIRDROP_ALLOCATION  = ethers.parseEther("100000000");
  const SALE_ALLOCATION     = ethers.parseEther("200000000");

  const now = Math.floor(Date.now() / 1000);
  const launchTime = now + 3600;
  const saleStart  = now + 3600;
  const saleEnd    = now + 7 * 24 * 60 * 60;

  // 1. Token
  console.log("\n📌 1- نشر Token...");
  const Token = await ethers.getContractFactory("Token");
  const token = await Token.deploy(
    TOKEN_NAME, TOKEN_SYMBOL, GOVERNANCE, TREASURY,
    deployer.address, deployer.address, deployer.address,
    TREASURY_ALLOCATION, VESTING_ALLOCATION, AIRDROP_ALLOCATION, SALE_ALLOCATION
  );
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("🪙 Token:", tokenAddr);

  // 2. Vesting
  console.log("\n📌 2- نشر Vesting...");
  const Vesting = await ethers.getContractFactory("Vesting");
  const vesting = await Vesting.deploy(tokenAddr, TREASURY, GOVERNANCE, launchTime);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log("🏦 Vesting:", vestingAddr);

  // 3. Sale
  console.log("\n📌 3- نشر Sale...");
  const Sale = await ethers.getContractFactory("Sale");
  const sale = await Sale.deploy(
    tokenAddr, vestingAddr, TREASURY, GOVERNANCE,
    10000n, SALE_ALLOCATION, ethers.parseEther("100"), saleStart, saleEnd
  );
  await sale.waitForDeployment();
  const saleAddr = await sale.getAddress();
  console.log("🛒 Sale:", saleAddr);

  // 4. Airdrop
  console.log("\n📌 4- نشر Airdrop...");
  const Airdrop = await ethers.getContractFactory("Airdrop");
  const airdrop = await Airdrop.deploy(tokenAddr, vestingAddr, TREASURY, GOVERNANCE);
  await airdrop.waitForDeployment();
  const airdropAddr = await airdrop.getAddress();
  console.log("🪂 Airdrop:", airdropAddr);

  // 5. إنشاء الاقتراحات وحفظها
  console.log("\n📌 5- إنشاء الاقتراحات وحفظها...");
  const pending: any[] = [];

  async function propose(contract: any, type: number, data: string, label: string, meta: any = {}) {
    console.log(`   📋 ${label}...`);
    const tx = await contract.connect(governanceSigner).proposeAction(type, data);
    const receipt = await tx.wait();
    const actionId = receipt?.logs[0]?.topics[1];
    console.log(`      🆔 ${actionId}`);
    pending.push({ label, contractAddress: await contract.getAddress(), actionType: type, actionId, meta });
    return actionId;
  }

  // 5.1 استثناء Vesting
  const excludeData = ethers.AbiCoder.defaultAbiCoder().encode(["address","bool"], [vestingAddr, true]);
  await propose(token, 0, excludeData, "استثناء Vesting", { contract: "Token" });

  // 5.2 منح Sale
  const saleDepData = ethers.AbiCoder.defaultAbiCoder().encode(["address","bool"], [saleAddr, true]);
  await propose(vesting, 2, saleDepData, "منح DEPOSITOR لـ Sale", { contract: "Vesting" });

  // 5.3 منح Airdrop
  const airdropDepData = ethers.AbiCoder.defaultAbiCoder().encode(["address","bool"], [airdropAddr, true]);
  await propose(vesting, 2, airdropDepData, "منح DEPOSITOR لـ Airdrop", { contract: "Vesting" });

  // 5.4 بدء البيع
  await propose(sale, 0, "0x", "بدء البيع", { contract: "Sale" });

  // 5.5 Merkle Root (استخدم قيمة وهمية غير صفرية)
  const fakeRoot = ethers.id("test-root");
  const deadline = now + 86400 * 7;
  const merkleData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32","uint256","uint256"],
    [fakeRoot, deadline, AIRDROP_ALLOCATION]
  );
  await propose(airdrop, 0, merkleData, "ضبط Merkle Root", { contract: "Airdrop" });

  // حفظ ملفات النشر
  const deployment = {
    network: network.name,
    deployer: deployer.address,
    governance: GOVERNANCE,
    Token: tokenAddr,
    Vesting: vestingAddr,
    Sale: saleAddr,
    Airdrop: airdropAddr,
    launchTime,
    saleStart,
    saleEnd
  };
  saveJson("sepolia", deployment);
  saveJson("pending-actions", { actions: pending, createdAt: new Date().toISOString() });

  console.log("\n✅ تم. انتظر ساعة كاملة ثم شغّل:");
  console.log("   npx hardhat run scripts/execute.ts --network sepolia");
}

main().catch((e) => { console.error(e); process.exit(1); });