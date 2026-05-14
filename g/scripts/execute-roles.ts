//تنفيذ الادوار معا الانتظار ل Timelock
import { ethers } from "hardhat";

async function main() {
  console.log("🚀 بدء عملية منح الأدوار...\n");

  // ═══════════════ اقرأ الحسابات ═══════════════
  const [deployer] = await ethers.getSigners();
  console.log("📌 Deployer:", deployer.address);

  // ═══════════════ العناوين (استبدلها بعناوينك) ═══════════════
  const TIMELOCK = process.env.TIMELOCK_ADDRESS || "0x00337C1B3424dd6dda3Ada4e66E31C412118AC13";
  const VESTING = process.env.VESTING_ADDRESS || "0x64875322b61Da6b6596D011e6BF0B6001c269DB2";
  const SALE = process.env.SALE_ADDRESS || "0xD00973CF68299d4a01688beD5412189E4B74FAB2";
  const AIRDROP = process.env.AIRDROP_ADDRESS || "0x4420d27c67Bc3415A9Ce231130304b39ddFF89E5";

  // ═══════════════ تعريف الدور ═══════════════
  const DEPOSITOR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DEPOSITOR_ROLE")
  );
  console.log("🔑 DEPOSITOR_ROLE:", DEPOSITOR_ROLE);

  // ═══════════════ ABIs ═══════════════
  const VESTING_ABI = [
    "function grantRole(bytes32 role, address account)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function getRoleAdmin(bytes32 role) view returns (bytes32)"
  ];

  const TIMELOCK_ABI = [
    "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)",
    "function execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)",
    "function hashOperation(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) view returns (bytes32)"
  ];

  // ═══════════════ إنشاء الكائنات ═══════════════
  const timelock = new ethers.Contract(TIMELOCK, TIMELOCK_ABI, deployer);
  const vesting = new ethers.Contract(VESTING, VESTING_ABI, deployer);

  // ═══════════════ التحقق من صلاحية Timelock ═══════════════
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // 0x00...00
  const adminRoleForDepositor = await vesting.getRoleAdmin(DEPOSITOR_ROLE);
  const timelockHasAdmin = await vesting.hasRole(adminRoleForDepositor, TIMELOCK);

  console.log("\n🔐 Admin role for DEPOSITOR_ROLE:", adminRoleForDepositor);
  console.log("🔐 Timelock has admin role?", timelockHasAdmin);

  if (!timelockHasAdmin) {
    console.error("❌ خطأ: عقد Timelock لا يملك صلاحية المسؤول على Vesting!");
    console.error("   قم بتنفيذ tog.ts أولاً لمنح DEFAULT_ADMIN_ROLE لـ Timelock.");
    process.exit(1);
  }

  // ═══════════════ تجهيز بيانات grantRole ═══════════════
  const saleData = vesting.interface.encodeFunctionData("grantRole", [
    DEPOSITOR_ROLE,
    SALE,
  ]);
  const airdropData = vesting.interface.encodeFunctionData("grantRole", [
    DEPOSITOR_ROLE,
    AIRDROP,
  ]);

  // ═══════════════ التأخير 5 دقائق ═══════════════
  const DELAY = 300; // بالثواني

  // ═══════════════ 1- جدولة Sale ═══════════════
  console.log("\n📅 جدولة منح DEPOSITOR_ROLE لـ Sale...");
  const tx1 = await timelock.schedule(
    VESTING,
    0,
    saleData,
    ethers.ZeroHash,
    ethers.ZeroHash,
    DELAY
  );
  await tx1.wait();
  console.log("✅ تمت الجدولة لـ Sale");

  // ═══════════════ 2- جدولة Airdrop ═══════════════
  console.log("📅 جدولة منح DEPOSITOR_ROLE لـ Airdrop...");
  const tx2 = await timelock.schedule(
    VESTING,
    0,
    airdropData,
    ethers.ZeroHash,
    ethers.ZeroHash,
    DELAY
  );
  await tx2.wait();
  console.log("✅ تمت الجدولة لـ Airdrop");

  // ═══════════════ انتظار المدة الزمنية ═══════════════
  console.log(`\n⏳ انتظار ${DELAY} ثانية...`);
  console.log("البدء:", new Date().toLocaleTimeString());
  await new Promise((resolve) => setTimeout(resolve, DELAY * 1000));
  console.log("الانتهاء:", new Date().toLocaleTimeString());

  // ═══════════════ 3- تنفيذ Sale ═══════════════
  console.log("\n🚀 تنفيذ منح الدور لـ Sale...");
  const tx3 = await timelock.execute(
    VESTING,
    0,
    saleData,
    ethers.ZeroHash,
    ethers.ZeroHash
  );
  await tx3.wait();
  console.log("✅ Sale مُنح DEPOSITOR_ROLE");

  // ═══════════════ 4- تنفيذ Airdrop ═══════════════
  console.log("🚀 تنفيذ منح الدور لـ Airdrop...");
  const tx4 = await timelock.execute(
    VESTING,
    0,
    airdropData,
    ethers.ZeroHash,
    ethers.ZeroHash
  );
  await tx4.wait();
  console.log("✅ Airdrop مُنح DEPOSITOR_ROLE");

  // ═══════════════ التحقق النهائي ═══════════════
  console.log("\n🔎 التحقق...");
  const saleHasRole = await vesting.hasRole(DEPOSITOR_ROLE, SALE);
  const airdropHasRole = await vesting.hasRole(DEPOSITOR_ROLE, AIRDROP);

  console.log(`Sale   -> ${saleHasRole ? "✅" : "❌"} DEPOSITOR_ROLE`);
  console.log(`Airdrop-> ${airdropHasRole ? "✅" : "❌"} DEPOSITOR_ROLE`);

  if (saleHasRole && airdropHasRole) {
    console.log("\n🎉 تم منح جميع الأدوار بنجاح!");
  } else {
    console.log("\n⚠️ فشل في بعض الأدوار. تحقق من المعاملات.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });