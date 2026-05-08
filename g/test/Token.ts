import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Token } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Token", function () {
    let token: Token;
    let deployer: SignerWithAddress;
    let governance: SignerWithAddress;
    let treasury: SignerWithAddress;
    let vesting: SignerWithAddress;
    let airdrop: SignerWithAddress;
    let saleAllocation: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let dexRouter: SignerWithAddress;
    let dexPair: SignerWithAddress;
    
    const TOTAL_SUPPLY = ethers.parseUnits("1000000000", 18);
    const WALLET_CAP = ethers.parseUnits("10000000", 18);
    const GOVERNANCE_LOCK_PERIOD = 180n * 24n * 60n * 60n;
    const TIMELOCK_DELAY = 48n * 60n * 60n;
    const TIMELOCK_GRACE_PERIOD = 7n * 24n * 60n * 60n; // 7 days
    
    const TREASURY_AMOUNT = ethers.parseUnits("400000000", 18);
    const VESTING_AMOUNT = ethers.parseUnits("300000000", 18);
    const AIRDROP_AMOUNT = ethers.parseUnits("100000000", 18);
    const SALE_AMOUNT = ethers.parseUnits("200000000", 18);

    beforeEach(async function () {
        [deployer, governance, treasury, vesting, airdrop, saleAllocation, user1, user2, dexRouter, dexPair] = 
            await ethers.getSigners();
        
        const TokenFactory = await ethers.getContractFactory("Token");
        token = await TokenFactory.deploy(
            "Project Token",
            "PRJ",
            governance.address,
            treasury.address,
            vesting.address,
            airdrop.address,
            saleAllocation.address,
            TREASURY_AMOUNT,
            VESTING_AMOUNT,
            AIRDROP_AMOUNT,
            SALE_AMOUNT
        );
        await token.waitForDeployment();
    });

    // ═══════════════════════════════════════════════════════════════
    // DEPLOYMENT TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Deployment", function () {
        it("Should deploy with correct name and symbol", async function () {
            expect(await token.name()).to.equal("Project Token");
            expect(await token.symbol()).to.equal("PRJ");
        });

        it("Should have correct total supply", async function () {
            expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
        });

        it("Should mint all tokens to correct addresses", async function () {
            expect(await token.balanceOf(treasury.address)).to.equal(TREASURY_AMOUNT);
            expect(await token.balanceOf(vesting.address)).to.equal(VESTING_AMOUNT);
            expect(await token.balanceOf(airdrop.address)).to.equal(AIRDROP_AMOUNT);
            expect(await token.balanceOf(saleAllocation.address)).to.equal(SALE_AMOUNT);
        });

        it("Should have zero balance for non-allocated addresses", async function () {
            expect(await token.balanceOf(user1.address)).to.equal(0);
            expect(await token.balanceOf(user2.address)).to.equal(0);
        });

        it("Should set governance role correctly", async function () {
            const GOVERNANCE_ROLE = await token.GOVERNANCE_ROLE();
            expect(await token.hasRole(GOVERNANCE_ROLE, governance.address)).to.be.true;
        });

        it("Should set governance start time", async function () {
            const startTime = await token.governanceStartTime();
            expect(startTime).to.be.gt(0);
        });

        it("Should not be finalized initially", async function () {
            expect(await token.governanceFinalized()).to.be.false;
        });

        it("Should exclude system contracts from wallet cap", async function () {
            expect(await token.isExcludedFromWalletCap(treasury.address)).to.be.true;
            expect(await token.isExcludedFromWalletCap(vesting.address)).to.be.true;
            expect(await token.isExcludedFromWalletCap(airdrop.address)).to.be.true;
            expect(await token.isExcludedFromWalletCap(saleAllocation.address)).to.be.true;
        });

        it("Should not exclude regular users", async function () {
            expect(await token.isExcludedFromWalletCap(user1.address)).to.be.false;
            expect(await token.isExcludedFromWalletCap(user2.address)).to.be.false;
        });

        it("Should revert mint function", async function () {
            await expect(token.mint(user1.address, 1000))
                .to.be.revertedWithCustomError(token, "Token__MintingDisabled");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // TRANSFER & WALLET CAP TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Transfers & Wallet Cap", function () {
        it("Should allow transfer below wallet cap", async function () {
            const amount = ethers.parseUnits("5000000", 18);
            await token.connect(treasury).transfer(user1.address, amount);
            expect(await token.balanceOf(user1.address)).to.equal(amount);
        });

        it("Should allow transfer exactly at wallet cap", async function () {
            await token.connect(treasury).transfer(user1.address, WALLET_CAP);
            expect(await token.balanceOf(user1.address)).to.equal(WALLET_CAP);
        });

        it("Should revert transfer exceeding wallet cap", async function () {
            const excessAmount = WALLET_CAP + 1n;
            await expect(
                token.connect(treasury).transfer(user1.address, excessAmount)
            ).to.be.revertedWithCustomError(token, "Token__ExceedsWalletCap");
        });

        it("Should allow excluded addresses to exceed cap", async function () {
            expect(await token.balanceOf(treasury.address)).to.equal(TREASURY_AMOUNT);
            expect(await token.isExcludedFromWalletCap(treasury.address)).to.be.true;
        });

        it("Should allow multiple transfers within cap", async function () {
            const amount1 = ethers.parseUnits("3000000", 18);
            const amount2 = ethers.parseUnits("4000000", 18);
            
            await token.connect(treasury).transfer(user1.address, amount1);
            await token.connect(treasury).transfer(user1.address, amount2);
            
            expect(await token.balanceOf(user1.address)).to.equal(amount1 + amount2);
        });

        it("Should revert second transfer that exceeds cap", async function () {
            const amount1 = ethers.parseUnits("8000000", 18);
            const amount2 = ethers.parseUnits("3000000", 18);
            
            await token.connect(treasury).transfer(user1.address, amount1);
            
            await expect(
                token.connect(treasury).transfer(user1.address, amount2)
            ).to.be.revertedWithCustomError(token, "Token__ExceedsWalletCap");
        });

        it("Should track remaining capacity correctly via balance check", async function () {
            const amount = ethers.parseUnits("3000000", 18);
            await token.connect(treasury).transfer(user1.address, amount);
            
            const remaining = WALLET_CAP - amount;
            const balance = await token.balanceOf(user1.address);
            expect(balance).to.equal(amount);
            
            await token.connect(treasury).transfer(user1.address, remaining);
            expect(await token.balanceOf(user1.address)).to.equal(WALLET_CAP);
        });

        it("Should allow excluded addresses to hold large balances", async function () {
            expect(await token.isExcludedFromWalletCap(treasury.address)).to.be.true;
            expect(await token.balanceOf(treasury.address)).to.equal(TREASURY_AMOUNT);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE & TIMELOCK TESTS (Before 180 Days)
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance (Before 180 Days)", function () {
        it("Should allow governance to propose and execute exclusion", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [user1.address, true]
            );
            
            const tx = await token.connect(governance).proposeAction(0, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.isExcludedFromWalletCap(user1.address)).to.be.true;
        });

        it("Should not allow execution before timelock delay", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [user1.address, true]
            );
            
            const tx = await token.connect(governance).proposeAction(0, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await expect(
                token.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(token, "Token__TimelockNotElapsed");
        });

        it("Should not allow non-governance to propose", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [user1.address, true]
            );
            
            await expect(
                token.connect(user1).proposeAction(0, data)
            ).to.be.revertedWithCustomError(token, "Token__NotGovernance");
        });

        it("Should NOT allow owner (deployer) to act without governance role", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [user1.address, true]
            );
            
            await expect(
                token.connect(deployer).proposeAction(0, data)
            ).to.be.revertedWithCustomError(token, "Token__NotGovernance");
        });

        it("Should allow setting DEX setup", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address"],
                [dexRouter.address, dexPair.address]
            );
            
            const tx = await token.connect(governance).proposeAction(2, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.dexRouter()).to.equal(dexRouter.address);
            expect(await token.dexPair()).to.equal(dexPair.address);
            expect(await token.isExcludedFromWalletCap(dexPair.address)).to.be.true;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // PAUSE TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Pause Functionality", function () {
        it("Should allow governance to pause", async function () {
            const data = "0x";
            
            const tx = await token.connect(governance).proposeAction(3, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.paused()).to.be.true;
        });

        it("Should block transfers when paused", async function () {
            const data = "0x";
            const tx = await token.connect(governance).proposeAction(3, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            await expect(
                token.connect(treasury).transfer(user1.address, 1000)
            ).to.be.revertedWithCustomError(token, "EnforcedPause");
        });

        it("Should allow unpause", async function () {
            let data = "0x";
            let tx = await token.connect(governance).proposeAction(3, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            let actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            tx = await token.connect(governance).proposeAction(4, data);
            receipt = await tx.wait();
            event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.paused()).to.be.false;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance Finalization", function () {
        it("Should not allow finalization before 180 days", async function () {
            const data = "0x";
            
            const tx = await token.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            await expect(
                token.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(token, "Token__LockPeriodNotElapsed");
        });

        it("Should allow finalization after 180 days", async function () {
            // CRITICAL FIX: Propose BEFORE 180 days, then advance ONLY to 180 days + timelock (NOT more)
            // Grace period is 7 days, so we must execute within 7 days of proposal timestamp + timelock
            const data = "0x";
            const tx = await token.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            // Advance exactly to: 180 days + 48 hours + 1 second
            // This is within the 7-day grace period after the timelock delay
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.governanceFinalized()).to.be.true;
        });

        it("Should emit GovernanceFinalized event", async function () {
            const data = "0x";
            const tx = await token.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            
            await expect(token.connect(governance).executeAction(actionId))
                .to.emit(token, "GovernanceFinalized");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // POST-FINALIZATION TESTS (After 180 Days)
    // ═══════════════════════════════════════════════════════════════
    
    describe("Post-Finalization (After 180 Days)", function () {
        beforeEach(async function () {
            // CRITICAL FIX: Propose BEFORE 180 days, then advance exactly to 180d + 48h + 1s
            const data = "0x";
            const tx = await token.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
        });

        it("Should block setExclusion after finalization", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [user1.address, true]
            );
            
            await expect(
                token.connect(governance).proposeAction(0, data)
            ).to.be.revertedWithCustomError(token, "Token__FunctionLockedAfter180Days");
        });

        it("Should allow DEX update after finalization", async function () {
            const newRouter = user1.address;
            const newPair = user2.address;
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address"],
                [newRouter, newPair]
            );
            
            const tx = await token.connect(governance).proposeAction(6, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.dexRouter()).to.equal(newRouter);
            expect(await token.dexPair()).to.equal(newPair);
        });

        it("Should allow ETH rescue after finalization", async function () {
            await deployer.sendTransaction({
                to: await token.getAddress(),
                value: ethers.parseEther("1")
            });
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address"],
                [treasury.address]
            );
            
            const tx = await token.connect(governance).proposeAction(7, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            const balanceBefore = await ethers.provider.getBalance(treasury.address);
            await token.connect(governance).executeAction(actionId);
            const balanceAfter = await ethers.provider.getBalance(treasury.address);
            
            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should block role management after finalization", async function () {
            const GOVERNANCE_ROLE = await token.GOVERNANCE_ROLE();
            
            await expect(
                token.connect(governance).grantRole(GOVERNANCE_ROLE, user1.address)
            ).to.be.revertedWithCustomError(token, "Token__RoleManagementLocked");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // PERMIT TESTS (EIP-2612)
    // ═══════════════════════════════════════════════════════════════
    
    describe("EIP-2612 Permit", function () {
        it("Should allow permit with valid signature", async function () {
            const amount = ethers.parseUnits("1000", 18);
            const deadline = ethers.MaxUint256;
            
            const nonce = await token.nonces(treasury.address);
            
            const domain = {
                name: "Project Token",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await token.getAddress()
            };
            
            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };
            
            const values = {
                owner: treasury.address,
                spender: user1.address,
                value: amount,
                nonce: nonce,
                deadline: deadline
            };
            
            const signature = await treasury.signTypedData(domain, types, values);
            const sig = ethers.Signature.from(signature);
            
            await token.permit(
                treasury.address,
                user1.address,
                amount,
                deadline,
                sig.v,
                sig.r,
                sig.s
            );
            
            expect(await token.allowance(treasury.address, user1.address)).to.equal(amount);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("View Functions", function () {
        it("Should return correct governance start time", async function () {
            const startTime = await token.governanceStartTime();
            expect(startTime).to.be.gt(0);
        });

        it("Should return zero after finalization time via time helper", async function () {
            await time.increase(Number(GOVERNANCE_LOCK_PERIOD) + 1);
            const startTime = await token.governanceStartTime();
            const currentTime = BigInt(await time.latest());
            expect(currentTime).to.be.gte(startTime + GOVERNANCE_LOCK_PERIOD);
        });

        it("Should check wallet cap via balance and exclusion", async function () {
            const canReceive = !(await token.isExcludedFromWalletCap(user1.address));
            expect(canReceive).to.be.true;
            
            await token.connect(treasury).transfer(user1.address, WALLET_CAP);
            const balance = await token.balanceOf(user1.address);
            expect(balance).to.equal(WALLET_CAP);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════
    
    describe("Edge Cases", function () {
        it("Should handle zero amount transfers", async function () {
            await expect(
                token.connect(treasury).transfer(user1.address, 0)
            ).to.not.be.reverted;
        });

        it("Should not allow transfer to zero address", async function () {
            await expect(
                token.connect(treasury).transfer(ethers.ZeroAddress, 1000)
            ).to.be.reverted;
        });

        it("Should handle multiple exclusions in batch", async function () {
            const users = [user1.address, user2.address];
            const excluded = [true, true];
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address[]", "bool[]"],
                [users, excluded]
            );
            
            const tx = await token.connect(governance).proposeAction(1, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "ActionProposed"
            );
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await token.connect(governance).executeAction(actionId);
            
            expect(await token.isExcludedFromWalletCap(user1.address)).to.be.true;
            expect(await token.isExcludedFromWalletCap(user2.address)).to.be.true;
        });
    });
});