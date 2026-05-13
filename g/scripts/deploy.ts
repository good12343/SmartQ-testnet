//النشر واعطى ومنح الادوار مالم تكن مقفله من تايم لوك 
import { ethers } from "hardhat";

async function main() {

    // =====================================================
    // CONFIGURATION
    // =====================================================

    const TOKEN_NAME = "EBRAHIM";           // TODO: اسم التوكن
    const TOKEN_SYMBOL = "EBH";         // TODO: رمز التوكن
    const GOVERNANCE_MULTISIG = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";  // TODO: عنوان Multi-sig
    const TIMELOCK_DELAY = 5 * 60;
    const TREASURY_WALLET = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";      // TODO: عنوان Treasury
    const SALE_TREASURY = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";        // TODO: عنوان Sale Treasury

    const TREASURY_SUPPLY = ethers.parseEther("400000000");
    const VESTING_SUPPLY = ethers.parseEther("300000000");
    const AIRDROP_SUPPLY = ethers.parseEther("100000000");
    const SALE_SUPPLY = ethers.parseEther("200000000");

    const NOW = Math.floor(Date.now() / 1000);
    const SALE_START = NOW + 300;
    const SALE_END = SALE_START + (30 * 24 * 60 * 60);

    const SALE_CAP = ethers.parseEther("200000000");
    const WALLET_CAP = ethers.parseEther("1000000");
    const MIN_PURCHASE = ethers.parseEther("100");

    // =====================================================
    // DEPLOYER
    // =====================================================

    const [deployer] = await ethers.getSigners();
    const deployerAddress = deployer.address;

    console.log("========================================");
    console.log("DEPLOYER:", deployerAddress);
    console.log("========================================");

    // =====================================================
    // STAGE 1: PREDICT ADDRESSES
    // =====================================================

    console.log("\nSTAGE 1 → Predicting Addresses...");

    const currentNonce = await ethers.provider.getTransactionCount(deployerAddress);

    const predictedTimelock = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce });
    const predictedOracle = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 1 });
    const predictedToken = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 2 });
    const predictedVesting = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 3 });
    const predictedAirdrop = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 4 });
    const predictedSale = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 5 });

    console.log("Predicted Timelock:", predictedTimelock);
    console.log("Predicted Oracle:", predictedOracle);
    console.log("Predicted Token:", predictedToken);
    console.log("Predicted Vesting:", predictedVesting);
    console.log("Predicted Airdrop:", predictedAirdrop);
    console.log("Predicted Sale:", predictedSale);

    // =====================================================
    // STAGE 2: DEPLOY GOVERNANCE CORE
    // =====================================================

    console.log("\nSTAGE 2 → Deploy Governance Core...");

    // ===== TIMELOCK =====
    const Timelock = await ethers.getContractFactory("ProjectTimelock");
    const timelock = await Timelock.deploy(
        TIMELOCK_DELAY,
        [GOVERNANCE_MULTISIG],
        [GOVERNANCE_MULTISIG],
        deployerAddress
    );
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();
    console.log("✅ Timelock:", timelockAddress);

    // ===== ORACLE (with Timelock as admin) =====
    const Oracle = await ethers.getContractFactory("PriceOracleV3");
    const oracle = await Oracle.deploy(timelockAddress); // ✅ FIXED: Timelock as admin
    await oracle.waitForDeployment();
    const oracleAddress = await oracle.getAddress();
    console.log("✅ Oracle:", oracleAddress);

    // ===== TOKEN =====
    console.log("\nDeploying Token...");
    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy(
        TOKEN_NAME,
        TOKEN_SYMBOL,
        timelockAddress,        // ✅ governance
        TREASURY_WALLET,        // ✅ treasury
        predictedVesting,       // ✅ predicted
        predictedAirdrop,       // ✅ predicted
        predictedSale,          // ✅ predicted
        TREASURY_SUPPLY,
        VESTING_SUPPLY,
        AIRDROP_SUPPLY,
        SALE_SUPPLY
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("✅ Token:", tokenAddress);

    // =====================================================
    // STAGE 3: DEPLOY APPLICATION LAYER
    // =====================================================

    console.log("\nSTAGE 3 → Deploy Application Layer...");

    // ===== VESTING (with Timelock as gov) =====
    const Vesting = await ethers.getContractFactory("Vesting");
    const vesting = await Vesting.deploy(
        tokenAddress,
        TREASURY_WALLET,
        timelockAddress,        // ✅ FIXED: Timelock as gov
        NOW
    );
    await vesting.waitForDeployment();
    const vestingAddress = await vesting.getAddress();
    console.log("✅ Vesting:", vestingAddress);

    // ===== AIRDROP (with Timelock as gov) =====
    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy(
        tokenAddress,
        vestingAddress,
        TREASURY_WALLET,
        timelockAddress         // ✅ FIXED: Timelock as gov
    );
    await airdrop.waitForDeployment();
    const airdropAddress = await airdrop.getAddress();
    console.log("✅ Airdrop:", airdropAddress);

    // ===== SALE (with Timelock as admin) =====
    const Sale = await ethers.getContractFactory("Sale");
    const sale = await Sale.deploy(
        tokenAddress,
        vestingAddress,
        oracleAddress,
        SALE_TREASURY,
        timelockAddress,        // ✅ FIXED: Timelock as admin
        SALE_CAP,
        WALLET_CAP,
        MIN_PURCHASE,
        SALE_START,
        SALE_END
    );
    await sale.waitForDeployment();
    const saleAddress = await sale.getAddress();
    console.log("✅ Sale:", saleAddress);

    // =====================================================
    // STAGE 4: SETUP ROLES
    // =====================================================

    console.log("\nSTAGE 4 → Setup Roles...");

    // Grant DEPOSITOR_ROLE to Sale and Airdrop in Vesting
    // Note: Only Timelock can do this, so we need to do it before renouncing
    // Or we can do it via Timelock proposal later
    
    // For now, grant via deployer (will be renounced later)
    const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));
    
    await (await vesting.grantRole(DEPOSITOR_ROLE, saleAddress)).wait();
    console.log("✅ Sale granted DEPOSITOR_ROLE");
    
    await (await vesting.grantRole(DEPOSITOR_ROLE, airdropAddress)).wait();
    console.log("✅ Airdrop granted DEPOSITOR_ROLE");

    // =====================================================
    // VALIDATION
    // =====================================================

    console.log("\n========================================");
    console.log("VALIDATING ADDRESSES");
    console.log("========================================");

    const checks = [
        { name: "Timelock", predicted: predictedTimelock, actual: timelockAddress },
        { name: "Oracle", predicted: predictedOracle, actual: oracleAddress },
        { name: "Token", predicted: predictedToken, actual: tokenAddress },
        { name: "Vesting", predicted: predictedVesting, actual: vestingAddress },
        { name: "Airdrop", predicted: predictedAirdrop, actual: airdropAddress },
        { name: "Sale", predicted: predictedSale, actual: saleAddress }
    ];

    let allMatch = true;
    for (const check of checks) {
        const match = check.predicted.toLowerCase() === check.actual.toLowerCase();
        console.log(`${check.name}: ${match ? "✅" : "❌"} ${check.actual}`);
        if (!match) allMatch = false;
    }

    if (!allMatch) {
        console.error("\n❌ ADDRESS MISMATCH DETECTED!");
        process.exit(1);
    }

    // =====================================================
    // SUMMARY
    // =====================================================

    console.log("\n========================================");
    console.log("DEPLOYMENT COMPLETE");
    console.log("========================================");
    console.log("Timelock:", timelockAddress);
    console.log("Oracle:", oracleAddress);
    console.log("Token:", tokenAddress);
    console.log("Vesting:", vestingAddress);
    console.log("Airdrop:", airdropAddress);
    console.log("Sale:", saleAddress);
    console.log("========================================");

    // =====================================================
    // STAGE 5: RENOUNCE ADMIN (Optional - do manually later)
    // =====================================================
    console.log("\n⚠️  Remember to renounce admin roles via Timelock after setup!");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
