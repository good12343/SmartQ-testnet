import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Token, Vesting } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Vesting", function () {
    let token: Token;
    let vesting: Vesting;
    let deployer: SignerWithAddress;
    let governance: SignerWithAddress;
    let treasury: SignerWithAddress;
    let depositor: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    
    const TOTAL_SUPPLY = ethers.parseUnits("1000000000", 18);
    const GOVERNANCE_LOCK_PERIOD = 180n * 24n * 60n * 60n;
    const TIMELOCK_DELAY = 48n * 60n * 60n;
    const CLIFF_PERIOD = 180n * 24n * 60n * 60n;
    const MONTHLY_INTERVAL = 30n * 24n * 60n * 60n;
    const CLAIM_EXPIRATION = 1095n * 24n * 60n * 60n;
    
    const TREASURY_AMOUNT = ethers.parseUnits("400000000", 18);
    const VESTING_AMOUNT = ethers.parseUnits("300000000", 18);
    const AIRDROP_AMOUNT = ethers.parseUnits("100000000", 18);
    const SALE_AMOUNT = ethers.parseUnits("200000000", 18);

    beforeEach(async function () {
        [deployer, governance, treasury, depositor, user1, user2, user3] = await ethers.getSigners();
        
        // Deploy Vesting FIRST (we need its address for Token)
        const currentTime = await time.latest();
        const VestingFactory = await ethers.getContractFactory("Vesting");
        vesting = await VestingFactory.deploy(
            ethers.ZeroAddress, // placeholder, will update after Token deploy
            treasury.address,
            governance.address,
            currentTime
        );
        await vesting.waitForDeployment();
        
        // Deploy Airdrop placeholder (needed for Token constructor)
        const AirdropFactory = await ethers.getContractFactory("Airdrop");
        const airdrop = await AirdropFactory.deploy(
            ethers.ZeroAddress,
            await vesting.getAddress(),
            treasury.address,
            governance.address
        );
        await airdrop.waitForDeployment();
        
        // Deploy Sale placeholder (needed for Token constructor)
        const futureTime = currentTime + 7 * 24 * 3600;
        const SaleFactory = await ethers.getContractFactory("Sale");
        const sale = await SaleFactory.deploy(
            ethers.ZeroAddress,
            await vesting.getAddress(),
            treasury.address,
            governance.address,
            1000000,
            ethers.parseUnits("50000000", 18),
            ethers.parseUnits("1000", 18),
            futureTime,
            futureTime + 7 * 24 * 3600
        );
        await sale.waitForDeployment();
        
        // Deploy Token with REAL addresses
        const TokenFactory = await ethers.getContractFactory("Token");
        token = await TokenFactory.deploy(
            "Project Token", "PRJ",
            governance.address, treasury.address,
            await vesting.getAddress(),
            await airdrop.getAddress(),
            await sale.getAddress(),
            TREASURY_AMOUNT, VESTING_AMOUNT, AIRDROP_AMOUNT, SALE_AMOUNT
        );
        await token.waitForDeployment();
        
        // Update Vesting with real token address
        // Note: Vesting doesn't have update function, so we need to redeploy
        // For testing, we'll use the Vesting with correct token from start
        // Actually, let's redeploy Vesting with correct token
        const VestingFactory2 = await ethers.getContractFactory("Vesting");
        vesting = await VestingFactory2.deploy(
            await token.getAddress(),
            treasury.address,
            governance.address,
            currentTime
        );
        await vesting.waitForDeployment();
        
        // Fund Vesting with tokens
        await token.connect(treasury).transfer(await vesting.getAddress(), VESTING_AMOUNT);
    });

    // ═══════════════════════════════════════════════════════════════
    // DEPLOYMENT TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Deployment", function () {
        it("Should set correct project token", async function () {
            expect(await vesting.projectToken()).to.equal(await token.getAddress());
        });

        it("Should set correct treasury", async function () {
            expect(await vesting.treasury()).to.equal(treasury.address);
        });

        it("Should set correct governance role", async function () {
            const GOVERNANCE_ROLE = await vesting.GOVERNANCE_ROLE();
            expect(await vesting.hasRole(GOVERNANCE_ROLE, governance.address)).to.be.true;
        });

        it("Should set correct project launch time", async function () {
            const launchTime = await vesting.projectLaunchTime();
            expect(launchTime).to.be.gt(0);
        });

        it("Should not be finalized initially", async function () {
            expect(await vesting.governanceFinalized()).to.be.false;
        });

        it("Should have zero total allocated initially", async function () {
            expect(await vesting.totalAllocated()).to.equal(0);
        });

        it("Should have zero total claimed initially", async function () {
            expect(await vesting.totalClaimedAmount()).to.equal(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // DEPOSIT & ALLOCATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Deposit & Allocation", function () {
        it("Should allow authorized to deposit tokens", async function () {
            const amount = ethers.parseUnits("1000000", 18);
            await token.connect(treasury).approve(await vesting.getAddress(), amount);
            
            // Grant depositor role to treasury for testing
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [treasury.address, true]
            );
            const tx = await vesting.connect(governance).proposeAction(2, data); // 2 = SetDepositor
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            await vesting.connect(treasury).depositTokens(amount);
            expect(await token.balanceOf(await vesting.getAddress())).to.equal(VESTING_AMOUNT + amount);
        });

        it("Should allow governance to allocate via timelock", async function () {
            const amount = ethers.parseUnits("1000000", 18);
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256"],
                [user1.address, amount]
            );
            
            const tx = await vesting.connect(governance).proposeAction(0, data); // 0 = Allocate
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            const schedule = await vesting.vestingSchedules(user1.address);
            expect(schedule.totalAllocation).to.equal(amount);
            expect(schedule.exists).to.be.true;
        });

        it("Should allow authorized direct allocation", async function () {
            const amount = ethers.parseUnits("1000000", 18);
            
            // Grant DEPOSITOR_ROLE to treasury
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [treasury.address, true]
            );
            const tx = await vesting.connect(governance).proposeAction(2, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            await vesting.connect(treasury).allocate(user1.address, amount);
            
            const schedule = await vesting.vestingSchedules(user1.address);
            expect(schedule.totalAllocation).to.equal(amount);
        });

        it("Should revert allocation for existing user", async function () {
            const amount = ethers.parseUnits("1000000", 18);
            
            await vesting.connect(governance).allocate(user1.address, amount);
            
            await expect(
                vesting.connect(governance).allocate(user1.address, amount)
            ).to.be.revertedWithCustomError(vesting, "Vesting__AllocationAlreadyExists");
        });

        it("Should revert allocation with zero amount", async function () {
            await expect(
                vesting.connect(governance).allocate(user1.address, 0)
            ).to.be.revertedWithCustomError(vesting, "Vesting__InvalidAmount");
        });

        it("Should allow batch allocation", async function () {
            const amounts = [ethers.parseUnits("1000000", 18), ethers.parseUnits("2000000", 18)];
            
            await vesting.connect(governance).batchAllocate([user1.address, user2.address], amounts);
            
            const schedule1 = await vesting.vestingSchedules(user1.address);
            const schedule2 = await vesting.vestingSchedules(user2.address);
            
            expect(schedule1.totalAllocation).to.equal(amounts[0]);
            expect(schedule2.totalAllocation).to.equal(amounts[1]);
        });

        it("Should revert batch allocation with mismatched arrays", async function () {
            await expect(
                vesting.connect(governance).batchAllocate([user1.address], [1000, 2000])
            ).to.be.revertedWithCustomError(vesting, "Vesting__InvalidAmount");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // CLAIM SYSTEM TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Claim System", function () {
        beforeEach(async function () {
            const amount = ethers.parseUnits("1000000", 18);
            await vesting.connect(governance).allocate(user1.address, amount);
        });

        it("Should not allow claim before cliff", async function () {
            await expect(
                vesting.connect(user1).claim()
            ).to.be.revertedWithCustomError(vesting, "Vesting__CliffNotReached");
        });

        it("Should allow first tranche claim after cliff", async function () {
            await time.increase(CLIFF_PERIOD + 1n);
            
            const beforeBalance = await token.balanceOf(user1.address);
            await vesting.connect(user1).claim();
            const afterBalance = await token.balanceOf(user1.address);
            
            const schedule = await vesting.vestingSchedules(user1.address);
            const expectedFirstTranche = schedule.totalAllocation * 2500n / 10000n; // 25%
            
            expect(afterBalance - beforeBalance).to.equal(expectedFirstTranche);
        });

        it("Should allow full claim after all tranches", async function () {
            await time.increase(CLIFF_PERIOD + (3n * MONTHLY_INTERVAL) + 1n);
            
            await vesting.connect(user1).claim();
            
            const schedule = await vesting.vestingSchedules(user1.address);
            expect(schedule.claimedAmount).to.equal(schedule.totalAllocation);
        });

        it("Should track claimed amount correctly", async function () {
            await time.increase(CLIFF_PERIOD + 1n);
            
            await vesting.connect(user1).claim();
            
            const schedule = await vesting.vestingSchedules(user1.address);
            expect(schedule.claimedAmount).to.be.gt(0);
        });

        it("Should not allow double claim without new tranche", async function () {
            await time.increase(CLIFF_PERIOD + 1n);
            
            await vesting.connect(user1).claim();
            
            await expect(
                vesting.connect(user1).claim()
            ).to.be.revertedWithCustomError(vesting, "Vesting__NothingToClaim");
        });

        it("Should allow claim even when contract is paused", async function () {
            await time.increase(CLIFF_PERIOD + 1n);
            
            // Pause the contract
            const data = "0x";
            const tx = await vesting.connect(governance).proposeAction(4, data); // 4 = Pause
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            // Claim should still work (claim is not blocked by pause)
            const beforeBalance = await token.balanceOf(user1.address);
            await vesting.connect(user1).claim();
            const afterBalance = await token.balanceOf(user1.address);
            
            expect(afterBalance).to.be.gt(beforeBalance);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE & TIMELOCK TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance & Timelock", function () {
        it("Should allow governance to propose and execute", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256"],
                [user1.address, ethers.parseUnits("1000000", 18)]
            );
            
            const tx = await vesting.connect(governance).proposeAction(0, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            const schedule = await vesting.vestingSchedules(user1.address);
            expect(schedule.exists).to.be.true;
        });

        it("Should not allow execution before timelock delay", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256"],
                [user1.address, 1000]
            );
            
            const tx = await vesting.connect(governance).proposeAction(0, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await expect(
                vesting.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(vesting, "Vesting__TimelockNotElapsed");
        });

        it("Should not allow non-governance to propose", async function () {
            await expect(
                vesting.connect(user1).proposeAction(0, "0x")
            ).to.be.revertedWithCustomError(vesting, "Vesting__NotGovernance");
        });

        it("Should allow pause via timelock", async function () {
            const data = "0x";
            const tx = await vesting.connect(governance).proposeAction(4, data); // 4 = Pause
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            expect(await vesting.paused()).to.be.true;
        });

        it("Should allow unpause via timelock", async function () {
            // Pause first
            let data = "0x";
            let tx = await vesting.connect(governance).proposeAction(4, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            let actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            // Unpause
            tx = await vesting.connect(governance).proposeAction(5, data); // 5 = Unpause
            receipt = await tx.wait();
            event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            expect(await vesting.paused()).to.be.false;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance Finalization", function () {
        it("Should not allow finalization before 180 days", async function () {
            const data = "0x";
            const tx = await vesting.connect(governance).proposeAction(6, data); // 6 = FinalizeGovernance
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            await expect(
                vesting.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(vesting, "Vesting__LockPeriodNotElapsed");
        });

        it("Should allow finalization after 180 days", async function () {
            // Propose BEFORE 180 days
            const data = "0x";
            const tx = await vesting.connect(governance).proposeAction(6, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            // Now advance past 180 days + timelock
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
            
            expect(await vesting.governanceFinalized()).to.be.true;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // POST-FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Post-Finalization", function () {
        beforeEach(async function () {
            // Propose BEFORE 180 days
            const data = "0x";
            const tx = await vesting.connect(governance).proposeAction(6, data); // 6 = FinalizeGovernance
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(actionId);
        });

        it("Should block allocation after finalization", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256"],
                [user1.address, 1000]
            );
            
            await expect(
                vesting.connect(governance).proposeAction(0, data)
            ).to.be.revertedWithCustomError(vesting, "Vesting__FunctionLockedAfter180Days");
        });

        it("Should allow rescue tokens after finalization", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint256"],
                [await token.getAddress(), treasury.address, ethers.parseUnits("1000", 18)]
            );
            
            const tx = await vesting.connect(governance).proposeAction(8, data); // 8 = RescueTokens
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            const beforeBalance = await token.balanceOf(treasury.address);
            await vesting.connect(governance).executeAction(actionId);
            const afterBalance = await token.balanceOf(treasury.address);
            
            expect(afterBalance).to.be.gt(beforeBalance);
        });

        it("Should block role management after finalization", async function () {
            const GOVERNANCE_ROLE = await vesting.GOVERNANCE_ROLE();
            
            await expect(
                vesting.connect(governance).grantRole(GOVERNANCE_ROLE, user1.address)
            ).to.be.revertedWithCustomError(vesting, "Vesting__RoleManagementLocked");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("View Functions", function () {
        it("Should calculate releasable correctly before cliff", async function () {
            await vesting.connect(governance).allocate(user1.address, ethers.parseUnits("1000000", 18));
            const releasable = await vesting.calculateReleasable(user1.address);
            expect(releasable).to.equal(0);
        });

        it("Should calculate releasable correctly after cliff", async function () {
            await vesting.connect(governance).allocate(user1.address, ethers.parseUnits("1000000", 18));
            await time.increase(CLIFF_PERIOD + 1n);
            
            const releasable = await vesting.calculateReleasable(user1.address);
            const expected = ethers.parseUnits("1000000", 18) * 2500n / 10000n; // 25%
            expect(releasable).to.equal(expected);
        });

        it("Should return correct reserved tokens", async function () {
            const amount = ethers.parseUnits("1000000", 18);
            await vesting.connect(governance).allocate(user1.address, amount);
            
            const reserved = await vesting.getReservedTokens();
            expect(reserved).to.equal(amount);
        });

        it("Should return correct excess tokens", async function () {
            const amount = ethers.parseUnits("1000000", 18);
            await vesting.connect(governance).allocate(user1.address, amount);
            
            const excess = await vesting.getExcessTokens();
            expect(excess).to.equal(VESTING_AMOUNT - amount);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // EXPIRED TOKENS TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Expired Tokens", function () {
        beforeEach(async function () {
            const amount = ethers.parseUnits("1000000", 18);
            await vesting.connect(governance).allocate(user1.address, amount);
        });

        it("Should not allow withdraw before expiration", async function () {
            await expect(
                vesting.connect(governance).withdrawExpired(user1.address)
            ).to.be.revertedWithCustomError(vesting, "Vesting__NotExpiredYet");
        });

        it("Should allow withdraw after claim expiration via timelock", async function () {
            await time.increase(CLAIM_EXPIRATION + 1n);
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address"],
                [user1.address]
            );
            
            const tx = await vesting.connect(governance).proposeAction(7, data); // 7 = WithdrawExpired
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            const beforeBalance = await token.balanceOf(treasury.address);
            await vesting.connect(governance).executeAction(actionId);
            const afterBalance = await token.balanceOf(treasury.address);
            
            expect(afterBalance).to.be.gt(beforeBalance);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════
    
    describe("Edge Cases", function () {
        it("Should handle zero amount deposit", async function () {
            await expect(
                vesting.connect(governance).depositTokens(0)
            ).to.be.revertedWithCustomError(vesting, "Vesting__InvalidAmount");
        });

        it("Should not allow allocation to zero address", async function () {
            await expect(
                vesting.connect(governance).allocate(ethers.ZeroAddress, 1000)
            ).to.be.revertedWithCustomError(vesting, "Vesting__ZeroAddress");
        });

        it("Should track total allocated correctly", async function () {
            const amount1 = ethers.parseUnits("1000000", 18);
            const amount2 = ethers.parseUnits("2000000", 18);
            
            await vesting.connect(governance).allocate(user1.address, amount1);
            await vesting.connect(governance).allocate(user2.address, amount2);
            
            expect(await vesting.totalAllocated()).to.equal(amount1 + amount2);
        });

        it("Should track user registration", async function () {
            await vesting.connect(governance).allocate(user1.address, 1000);
            expect(await vesting.isUserRegistered(user1.address)).to.be.true;
            expect(await vesting.isUserRegistered(user2.address)).to.be.false;
        });
    });
});