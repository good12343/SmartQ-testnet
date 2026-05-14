import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = deployer.address;

    console.log("========================================");
    console.log("DEPLOYER:", deployerAddress);
    console.log("========================================");

    // ─── CONFIG ────────────────────────────────────────────────
    const TOKEN_NAME = process.env.TOKEN_NAME || "FOR Token";
    const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "FOR";
    const GOVERNANCE_MULTISIG = process.env.GOVERNANCE_MULTISIG!;
    const TREASURY_WALLET = process.env.TREASURY_WALLET!;

    if (!GOVERNANCE_MULTISIG || !TREASURY_WALLET) {
        throw new Error("Missing GOVERNANCE_MULTISIG or TREASURY_WALLET in .env");
    }

    // ─── TOKEN ALLOCATIONS ─────────────────────────────────────
    const TREASURY_AMOUNT = ethers.parseUnits("400000000", 18);
    const VESTING_AMOUNT  = ethers.parseUnits("300000000", 18);
    const AIRDROP_AMOUNT  = ethers.parseUnits("100000000", 18);
    const SALE_AMOUNT     = ethers.parseUnits("200000000", 18);

    console.log("\n🔮 Predicting addresses...");

    const nonce = await ethers.provider.getTransactionCount(deployerAddress);

    const predictedTimelock = ethers.getCreateAddress({ from: deployerAddress, nonce });
    const predictedOracle   = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 1 });
    const predictedToken    = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 2 });
    const predictedVesting  = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 3 });
    const predictedAirdrop  = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 4 });
    const predictedSale     = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 5 });

    // ─── DEPLOY 1/6 TIMLOCK ────────────────────────────────────
    const Timelock = await ethers.getContractFactory("ProjectTimelock");
    const timelock = await Timelock.deploy(
        300,
        [GOVERNANCE_MULTISIG],
        [GOVERNANCE_MULTISIG],
        deployerAddress
    );
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();

    // ─── DEPLOY 2/6 ORACLE ─────────────────────────────────────
    const Oracle = await ethers.getContractFactory("PriceOracleV3");
    const oracle = await Oracle.deploy(timelockAddress);
    await oracle.waitForDeployment();
    const oracleAddress = await oracle.getAddress();

    // ─── DEPLOY 3/6 TOKEN ──────────────────────────────────────
    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy(
        TOKEN_NAME,
        TOKEN_SYMBOL,
        timelockAddress,
        TREASURY_WALLET,
        predictedVesting,
        predictedAirdrop,
        predictedSale,
        TREASURY_AMOUNT,
        VESTING_AMOUNT,
        AIRDROP_AMOUNT,
        SALE_AMOUNT
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    // ─── DEPLOY 4/6 VESTING ────────────────────────────────────
    const Vesting = await ethers.getContractFactory("Vesting");
    const vesting = await Vesting.deploy(
        tokenAddress,
        TREASURY_WALLET,
        timelockAddress,
        Math.floor(Date.now() / 1000)
    );
    await vesting.waitForDeployment();
    const vestingAddress = await vesting.getAddress();

    // ─── DEPLOY 5/6 AIRDROP ────────────────────────────────────
    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy(
        tokenAddress,
        vestingAddress,
        TREASURY_WALLET,
        timelockAddress
    );
    await airdrop.waitForDeployment();
    const airdropAddress = await airdrop.getAddress();

    // ─── SALE TIME ─────────────────────────────────────────────
    const block = await ethers.provider.getBlock("latest");
    if (!block) throw new Error("No block found");

    const now = block.timestamp;
    const end = now + 30 * 24 * 60 * 60;

    // ─── DEPLOY 6/6 SALE ───────────────────────────────────────
    const Sale = await ethers.getContractFactory("Sale");
    const sale = await Sale.deploy(
        tokenAddress,
        vestingAddress,
        oracleAddress,
        TREASURY_WALLET,
        timelockAddress,

        ethers.parseUnits("200000000", 18), // saleCap
        ethers.parseUnits("1000000", 18),   // walletCap
        ethers.parseUnits("100", 18),       // minPurchase

        now,
        end
    );

    await sale.waitForDeployment();
    const saleAddress = await sale.getAddress();

    // ─── OUTPUT ────────────────────────────────────────────────
    console.log("\n========================================");
    console.log("DEPLOYMENT COMPLETE");
    console.log("========================================");
    console.log("Token     :", tokenAddress);
    console.log("Vesting   :", vestingAddress);
    console.log("Airdrop   :", airdropAddress);
    console.log("Sale      :", saleAddress);
    console.log("Oracle    :", oracleAddress);
    console.log("Timelock  :", timelockAddress);
    console.log("========================================");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});