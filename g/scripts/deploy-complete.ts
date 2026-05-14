import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = deployer.address;

    console.log("========================================");
    console.log("DEPLOYER:", deployerAddress);
    console.log("========================================");

    // ─── CONFIG ─────────────────────────────────────────────────────────────
    const TOKEN_NAME = "Ebrahim";
    const TOKEN_SYMBOL = "Ebr";
    const GOVERNANCE_MULTISIG = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";
    const TREASURY_WALLET = "0x54FdC4531400dAA82C00B68c5c91dB327Abdf15c";

    // ─── TOKEN ALLOCATIONS ──────────────────────────────────────────────────
    const TREASURY_AMOUNT = ethers.parseEther("400000000");  // 400M
    const VESTING_AMOUNT  = ethers.parseEther("300000000");  // 300M
    const AIRDROP_AMOUNT  = ethers.parseEther("100000000");  // 100M
    const SALE_AMOUNT     = ethers.parseEther("200000000");  // 200M

    // ─── SALE CONFIG ────────────────────────────────────────────────────────
    const NOW = Math.floor(Date.now() / 1000);
    const SALE_START = NOW;                           // يبدأ الآن!
    const SALE_END = NOW + (30 * 24 * 60 * 60);      // بعد 30 يوم
    const MIN_PURCHASE = ethers.parseEther("0.001"); // 0.001 ETH
    const WALLET_CAP = ethers.parseEther("10000");     // 10K tokens
    const SALE_CAP = ethers.parseEther("200000000");   // 200M tokens

    // ─── STAGE 1: PREDICT ADDRESSES ─────────────────────────────────────────
    console.log("\\n🔮 Predicting addresses...");
    const nonce = await ethers.provider.getTransactionCount(deployerAddress);

    const predictedTimelock = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce });
    const predictedOracle   = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 1 });
    const predictedToken    = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 2 });
    const predictedVesting  = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 3 });
    const predictedAirdrop  = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 4 });
    const predictedSale     = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 5 });

    console.log("Timelock:", predictedTimelock);
    console.log("Oracle:", predictedOracle);
    console.log("Token:", predictedToken);
    console.log("Vesting:", predictedVesting);
    console.log("Airdrop:", predictedAirdrop);
    console.log("Sale:", predictedSale);

    // ─── STAGE 2: DEPLOY ─────────────────────────────────────────────────────
    
    // 1. Timelock
    console.log("\\n🚀 1/6 Deploying Timelock...");
    const Timelock = await ethers.getContractFactory("ProjectTimelock");
    const timelock = await Timelock.deploy(300, [GOVERNANCE_MULTISIG], [GOVERNANCE_MULTISIG], deployerAddress);
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();
    console.log("✅ Timelock:", timelockAddress);

    // 2. Oracle
    console.log("\\n🚀 2/6 Deploying Oracle...");
    const Oracle = await ethers.getContractFactory("PriceOracleV3");
    const oracle = await Oracle.deploy(timelockAddress);
    await oracle.waitForDeployment();
    const oracleAddress = await oracle.getAddress();
    console.log("✅ Oracle:", oracleAddress);

    // 3. Token
    console.log("\\n🚀 3/6 Deploying Token...");
    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy(
        TOKEN_NAME, TOKEN_SYMBOL,
        timelockAddress, TREASURY_WALLET,
        predictedVesting, predictedAirdrop, predictedSale,
        TREASURY_AMOUNT, VESTING_AMOUNT, AIRDROP_AMOUNT, SALE_AMOUNT
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("✅ Token:", tokenAddress);

    // 4. Vesting (Deployer as admin temporarily!)
    console.log("\\n🚀 4/6 Deploying Vesting...");
    const Vesting = await ethers.getContractFactory("Vesting");
    const vesting = await Vesting.deploy(tokenAddress, TREASURY_WALLET, deployerAddress, NOW);  // ← Deployer admin!
    await vesting.waitForDeployment();
    const vestingAddress = await vesting.getAddress();
    console.log("✅ Vesting:", vestingAddress);

    // 5. Airdrop
    console.log("\\n🚀 5/6 Deploying Airdrop...");
    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy(tokenAddress, vestingAddress, TREASURY_WALLET, timelockAddress);
    await airdrop.waitForDeployment();
    const airdropAddress = await airdrop.getAddress();
    console.log("✅ Airdrop:", airdropAddress);

    // 6. Sale (with correct values!)
    console.log("\\n🚀 6/6 Deploying Sale...");
    const Sale = await ethers.getContractFactory("Sale");
    const sale = await Sale.deploy(
        tokenAddress, vestingAddress, oracleAddress, TREASURY_WALLET,
        GOVERNANCE_MULTISIG,  // Admin = Multi-sig
        SALE_CAP, WALLET_CAP, MIN_PURCHASE, SALE_START, SALE_END
    );
    await sale.waitForDeployment();
    const saleAddress = await sale.getAddress();
    console.log("✅ Sale:", saleAddress);

    // ─── STAGE 3: SETUP ROLES (Deployer is admin on Vesting!) ──────────────
    console.log("\\n🔧 Setting up roles...");

    // Grant DEPOSITOR_ROLE to Sale and Airdrop on Vesting
    const DEPOSITOR_ROLE = await vesting.DEPOSITOR_ROLE();
    await (await vesting.grantRole(DEPOSITOR_ROLE, saleAddress)).wait();
    console.log("✅ Sale granted DEPOSITOR_ROLE on Vesting");
    await (await vesting.grantRole(DEPOSITOR_ROLE, airdropAddress)).wait();
    console.log("✅ Airdrop granted DEPOSITOR_ROLE on Vesting");

    // Transfer Vesting ownership to Timelock
    const DEFAULT_ADMIN_ROLE = await vesting.DEFAULT_ADMIN_ROLE();
    await (await vesting.grantRole(DEFAULT_ADMIN_ROLE, timelockAddress)).wait();
    console.log("✅ Timelock granted DEFAULT_ADMIN_ROLE on Vesting");
    await (await vesting.renounceRole(DEFAULT_ADMIN_ROLE, deployerAddress)).wait();
    console.log("✅ Deployer renounced DEFAULT_ADMIN_ROLE on Vesting");

    // ─── STAGE 4: VALIDATION ─────────────────────────────────────────────────
    console.log("\\n========================================");
    console.log("VALIDATION");
    console.log("========================================");

    const checks = [
        { name: "Timelock", p: predictedTimelock, a: timelockAddress },
        { name: "Oracle", p: predictedOracle, a: oracleAddress },
        { name: "Token", p: predictedToken, a: tokenAddress },
        { name: "Vesting", p: predictedVesting, a: vestingAddress },
        { name: "Airdrop", p: predictedAirdrop, a: airdropAddress },
        { name: "Sale", p: predictedSale, a: saleAddress }
    ];

    let allMatch = true;
    for (const c of checks) {
        const match = c.p.toLowerCase() === c.a.toLowerCase();
        console.log(`${c.name}: ${match ? "✅" : "❌"} ${c.a}`);
        if (!match) allMatch = false;
    }

    if (!allMatch) {
        console.error("\\n❌ ADDRESS MISMATCH!");
        process.exit(1);
    }

    // ─── STAGE 5: VERIFY SALE CONFIG ───────────────────────────────────────
    console.log("\\n========================================");
    console.log("SALE CONFIG");
    console.log("========================================");

    const saleMinPurchase = await sale.minPurchase();
    const saleStart = await sale.saleStart();
    const saleEnd = await sale.saleEnd();
    const salePaused = await sale.paused();
    const saleFinalized = await sale.finalized();

    console.log("minPurchase:", ethers.formatEther(saleMinPurchase), "ETH");
    console.log("saleStart:", new Date(Number(saleStart) * 1000).toISOString());
    console.log("saleEnd:", new Date(Number(saleEnd) * 1000).toISOString());
    console.log("paused:", salePaused);
    console.log("finalized:", saleFinalized);

    // ─── SUMMARY ─────────────────────────────────────────────────────────────
    console.log("\\n========================================");
    console.log("DEPLOYMENT COMPLETE");
    console.log("========================================");
    console.log("Token Name :", TOKEN_NAME);
    console.log("Token Symbol:", TOKEN_SYMBOL);
    console.log("Governance :", GOVERNANCE_MULTISIG);
    console.log("Treasury   :", TREASURY_WALLET);
    console.log("----------------------------------------");
    console.log("Timelock   :", timelockAddress);
    console.log("Oracle     :", oracleAddress);
    console.log("Token      :", tokenAddress);
    console.log("Vesting    :", vestingAddress);
    console.log("Airdrop    :", airdropAddress);
    console.log("Sale       :", saleAddress);
    console.log("========================================");
    console.log("\\n✅ Sale is ACTIVE now!");
    console.log("✅ minPurchase = 0.001 ETH");
    console.log("✅ Admin = Multi-sig (0x54FdC...)");
    console.log("✅ DEPOSITOR_ROLE granted to Sale & Airdrop");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});