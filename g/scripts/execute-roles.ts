import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    
    // ═══════════════════ عناوين النشر ═══════════════════
    const TIMELOCK = "0x106628307cE23559c756C139c1A0EA39E5661FF6";
    const VESTING = "0x5005683d28837692069b042D7277Ff7CEb6636F0";
    const SALE = "0x07990E955001b7099B22dA37594542d85FD2c624";
    const AIRDROP = "0x99A9bD1bb7d441adE84eD412549C2b61F3DF2B44";
    
    // ═══════════════════ الـ Role ═══════════════════
    const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));
    console.log("DEPOSITOR_ROLE:", DEPOSITOR_ROLE);
    
    // ═══════════════════ ABI ═══════════════════
    const VESTING_ABI = [
        "function grantRole(bytes32 role, address account)",
        "function hasRole(bytes32 role, address account) view returns (bool)"
    ];
    
    const TIMELOCK_ABI = [
        "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)",
        "function execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)",
        "function hashOperation(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) view returns (bytes32)"
    ];
    
    const timelock = new ethers.Contract(TIMELOCK, TIMELOCK_ABI, deployer);
    const vesting = new ethers.Contract(VESTING, VESTING_ABI, deployer);
    
    // ═══════════════════ إعداد البيانات ═══════════════════
    const saleData = vesting.interface.encodeFunctionData("grantRole", [DEPOSITOR_ROLE, SALE]);
    const airdropData = vesting.interface.encodeFunctionData("grantRole", [DEPOSITOR_ROLE, AIRDROP]);
    
    // ═══════════════════ Schedule Sale ═══════════════════
    console.log("\\n📋 Scheduling Sale grantRole...");
    const saleTx = await timelock.schedule(
        VESTING,
        0,
        saleData,
        ethers.ZeroHash,
        ethers.ZeroHash,
        300 // 5 دقائق
    );
    await saleTx.wait();
    console.log("✅ Sale scheduled");
    
    // ═══════════════════ Schedule Airdrop ═══════════════════
    console.log("\\n📋 Scheduling Airdrop grantRole...");
    const airdropTx = await timelock.schedule(
        VESTING,
        0,
        airdropData,
        ethers.ZeroHash,
        ethers.ZeroHash,
        300 // 5 دقائق
    );
    await airdropTx.wait();
    console.log("✅ Airdrop scheduled");
    
    // ═══════════════════ انتظر 5 دقائق ═══════════════════
    console.log("\\n⏳ Waiting 5 minutes for Timelock delay...");
    console.log("Started at:", new Date().toLocaleTimeString());
    await new Promise(resolve => setTimeout(resolve, 300000)); // 5 دقائق
    console.log("Finished at:", new Date().toLocaleTimeString());
    
    // ═══════════════════ Execute Sale ═══════════════════
    console.log("\\n🚀 Executing Sale grantRole...");
    const execSale = await timelock.execute(
        VESTING,
        0,
        saleData,
        ethers.ZeroHash,
        ethers.ZeroHash
    );
    await execSale.wait();
    console.log("✅ Sale DEPOSITOR_ROLE granted!");
    
    // ═══════════════════ Execute Airdrop ═══════════════════
    console.log("\\n🚀 Executing Airdrop grantRole...");
    const execAirdrop = await timelock.execute(
        VESTING,
        0,
        airdropData,
        ethers.ZeroHash,
        ethers.ZeroHash
    );
    await execAirdrop.wait();
    console.log("✅ Airdrop DEPOSITOR_ROLE granted!");
    
    // ═══════════════════ التحقق ═══════════════════
    console.log("\\n🔍 Verification:");
    const saleHasRole = await vesting.hasRole(DEPOSITOR_ROLE, SALE);
    const airdropHasRole = await vesting.hasRole(DEPOSITOR_ROLE, AIRDROP);
    
    console.log("Sale has DEPOSITOR_ROLE:", saleHasRole ? "✅ YES" : "❌ NO");
    console.log("Airdrop has DEPOSITOR_ROLE:", airdropHasRole ? "✅ YES" : "❌ NO");
    
    if (saleHasRole && airdropHasRole) {
        console.log("\\n🎉 All roles granted successfully!");
    } else {
        console.log("\\n⚠️  Some roles missing - check transactions");
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});