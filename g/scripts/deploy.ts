import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
  // 🔐 التحقق من وجود المفتاح
    if (!process.env.PRIVATE_KEY) {
        throw new Error("❌ Missing PRIVATE_KEY in .env");
          }

            const [deployer] = await ethers.getSigners();

              console.log(`🚀 Deploying contracts with account: ${deployer.address}`);
                console.log(`💰 Balance: ${await ethers.provider.getBalance(deployer.address)}`);

                  // -----------------------------
                    // ⚙️ إعدادات المشروع
                      // -----------------------------
                        const timelock: string = deployer.address;

                          // 🪙 اسم ورمز التوكن
                            const tokenName: string = "Fort";
                              const tokenSymbol: string = "FOR";

                                // 💡 توزيع أولي
                                  const recipients: string[] = [deployer.address];
                                    const amounts: bigint[] = [
                                        ethers.parseUnits("1000000000", 18)
                                          ];

                                            // 🔐 Vesting signers (تم التعديل هنا)
                                              const signers: string[] = [
                                                  "0xa4d3c6aba50a9d6aa11e2de4bfe0c24016597cd4",
                                                      "0x2b1b0a11734b20798a4d509ee379e2c5112ab616"
                                                        ];

                                                          const threshold: number = 2;

                                                            console.log("\n--- 🚧 Starting Deployment ---\n");

                                                              // -----------------------------
                                                                // 1. Deploy Token
                                                                  // -----------------------------
                                                                    const ProjectToken = await ethers.getContractFactory("ProjectToken");

                                                                      const token = await ProjectToken.deploy(
                                                                          tokenName,
                                                                              tokenSymbol,
                                                                                  timelock,
                                                                                      recipients,
                                                                                          amounts,
                                                                                              ethers.ZeroAddress
                                                                                                );

                                                                                                  await token.waitForDeployment();
                                                                                                    const tokenAddress = await token.getAddress();

                                                                                                      console.log(`✅ Token deployed: ${tokenAddress}`);

                                                                                                        // -----------------------------
                                                                                                          // 2. Deploy Vesting
                                                                                                            // -----------------------------
                                                                                                              const Vesting = await ethers.getContractFactory("Vesting");

                                                                                                                const vesting = await Vesting.deploy(
                                                                                                                    tokenAddress,
                                                                                                                        timelock,
                                                                                                                            signers,
                                                                                                                                threshold
                                                                                                                                  );

                                                                                                                                    await vesting.waitForDeployment();
                                                                                                                                      const vestingAddress = await vesting.getAddress();

                                                                                                                                        console.log(`✅ Vesting deployed: ${vestingAddress}`);

                                                                                                                                          // -----------------------------
                                                                                                                                            // 3. Deploy Airdrop
                                                                                                                                              // -----------------------------
                                                                                                                                                const Airdrop = await ethers.getContractFactory("Airdrop");

                                                                                                                                                  const airdrop = await Airdrop.deploy(
                                                                                                                                                      tokenAddress,
                                                                                                                                                          timelock
                                                                                                                                                            );

                                                                                                                                                              await airdrop.waitForDeployment();
                                                                                                                                                                const airdropAddress = await airdrop.getAddress();

                                                                                                                                                                  console.log(`✅ Airdrop deployed: ${airdropAddress}`);

                                                                                                                                                                    // -----------------------------
                                                                                                                                                                      // 📊 Summary
                                                                                                                                                                        // -----------------------------
                                                                                                                                                                          console.log("\n==============================");
                                                                                                                                                                            console.log("📦 DEPLOYMENT SUCCESSFUL");
                                                                                                                                                                              console.log("==============================");
                                                                                                                                                                                console.log(`Token:   ${tokenAddress}`);
                                                                                                                                                                                  console.log(`Vesting: ${vestingAddress}`);
                                                                                                                                                                                    console.log(`Airdrop: ${airdropAddress}`);
                                                                                                                                                                                      console.log("==============================\n");
                                                                                                                                                                                      }

                                                                                                                                                                                      main()
                                                                                                                                                                                        .then(() => process.exit(0))
                                                                                                                                                                                          .catch((error) => {
                                                                                                                                                                                              console.error("❌ Deployment failed:", error);
                                                                                                                                                                                                  process.exit(1);
                                                                                                                                                                                                    });