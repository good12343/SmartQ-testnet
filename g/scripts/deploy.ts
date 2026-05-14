import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = deployer.address;

    console.log("========================================");
    console.log("DEPLOYER:", deployerAddress);
    console.log("========================================");

    // ─── CONFIG (الضروري فقط) ────────────────────────────────────────────────
    const TOKEN_NAME = process.env.TOKEN_NAME || "FOR Token";
    const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "FOR";
    const GOVERNANCE_MULTISIG = process.env.GOVERNANCE_MULTISIG!;
    const TREASURY_WALLET = process.env.TREASURY_WALLET!;

    if (!GOVERNANCE_MULTISIG || !TREASURY_WALLET) {
        throw new Error("Missing GOVERNANCE_MULTISIG or TREASURY_WALLET in .env");
    }

    // ─── TOKEN ALLOCATIONS (يجب أن تساوي 1B = TOTAL_SUPPLY) ─────────────────
    const TREASURY_AMOUNT = ethers.parseEther("400000000");  // 400M
    const VESTING_AMOUNT  = ethers.parseEther("300000000");  // 300M
    const AIRDROP_AMOUNT  = ethers.parseEther("100000000");  // 100M
    const SALE_AMOUNT     = ethers.parseEther("200000000");  // 200M
    // المجموع = 1,000,000,000 ✅

    // ─── STAGE 1: PREDICT ALL ADDRESSES ──────────────────────────────────────
    console.log("\\n🔮 Predicting addresses...");

    const nonce = await ethers.provider.getTransactionCount(deployerAddress);

    const predictedTimelock = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce });
    const predictedOracle   = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 1 });
    const predictedToken    = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 2 });
    const predictedVesting  = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 3 });
    const predictedAirdrop  = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 4 });
    const predictedSale     = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 5 });

    console.log("Timelock (predicted): ", predictedTimelock);
    console.log("Oracle   (predicted): ", predictedOracle);
    console.log("Token    (predicted): ", predictedToken);
    console.log("Vesting  (predicted): ", predictedVesting);
    console.log("Airdrop  (predicted): ", predictedAirdrop);
    console.log("Sale     (predicted): ", predictedSale);

    // ─── STAGE 2: DEPLOY ─────────────────────────────────────────────────────

    // 1. Timelock
    console.log("\\n🚀 1/6 Deploying Timelock...");
    const Timelock = await ethers.getContractFactory("ProjectTimelock");
    const timelock = await Timelock.deploy(
        300,
        [GOVERNANCE_MULTISIG],
        [GOVERNANCE_MULTISIG],
        deployerAddress
    );
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

    // 3. Token (with predicted addresses + correct allocations)
    console.log("\\n🚀 3/6 Deploying Token...");
    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy(
        TOKEN_NAME,
        TOKEN_SYMBOL,
        timelockAddress,        // governance
        TREASURY_WALLET,        // treasury
        predictedVesting,       // vesting (predicted)
        predictedAirdrop,       // airdrop (predicted)
        predictedSale,          // sale (predicted)
        TREASURY_AMOUNT,
        VESTING_AMOUNT,
        AIRDROP_AMOUNT,
        SALE_AMOUNT
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("✅ Token:", tokenAddress);

    // 4. Vesting
    console.log("\\n🚀 4/6 Deploying Vesting...");
    const Vesting = await ethers.getContractFactory("Vesting");
    const vesting = await Vesting.deploy(
        tokenAddress,
        TREASURY_WALLET,
        timelockAddress,
        Math.floor(Date.now() / 1000)
    );
    await vesting.waitForDeployment();
    const vestingAddress = await vesting.getAddress();
    console.log("✅ Vesting:", vestingAddress);

    // 5. Airdrop
    console.log("\\n🚀 5/6 Deploying Airdrop...");
    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy(
        tokenAddress,
        vestingAddress,
        TREASURY_WALLET,
        timelockAddress
    );
    await airdrop.waitForDeployment();
    const airdropAddress = await airdrop.getAddress();
    console.log("✅ Airdrop:", airdropAddress);

    // 6. Sale
    console.log("\\n🚀 6/6 Deploying Sale...");
    const Sale = await ethers.getContractFactory("Sale");
    const sale = await Sale.deploy(
        tokenAddress,
        vestingAddress,
        oracleAddress,
        TREASURY_WALLET,
        timelockAddress,
        0,  // saleCap    → العقد يحدد
        0,  // walletCap  → العقد يحدد
        0,  // minPurchase→ العقد يحدد
        0,  // start      → العقد يحدد
        0   // end        → العقد يحدد
    );
    await sale.waitForDeployment();
    const saleAddress = await sale.getAddress();
    console.log("✅ Sale:", saleAddress);

    // ─── VALIDATION ──────────────────────────────────────────────────────────
    console.log("\\n========================================");
    console.log("VALIDATION");
    console.log("========================================");

    const checks = [
        { name: "Timelock", p: predictedTimelock, a: timelockAddress },
        { name: "Oracle",   p: predictedOracle,   a: oracleAddress },
        { name: "Token",    p: predictedToken,    a: tokenAddress },
        { name: "Vesting",  p: predictedVesting,  a: vestingAddress },
        { name: "Airdrop",  p: predictedAirdrop,  a: airdropAddress },
        { name: "Sale",     p: predictedSale,     a: saleAddress },
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
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});