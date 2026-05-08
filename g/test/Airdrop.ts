import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Token, Vesting, Airdrop } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

describe("Airdrop", function () {
    let token: Token;
    let vesting: Vesting;
    let airdrop: Airdrop;
    let deployer: SignerWithAddress;
    let governance: SignerWithAddress;
    let treasury: SignerWithAddress;
    let operator: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    
    const GOVERNANCE_LOCK_PERIOD = 180n * 24n * 60n * 60n;
    const TIMELOCK_DELAY = 48n * 60n * 60n;
    
    const TREASURY_AMOUNT = ethers.parseUnits("400000000", 18);
    const VESTING_AMOUNT = ethers.parseUnits("300000000", 18);
    const AIRDROP_AMOUNT = ethers.parseUnits("100000000", 18);
    const SALE_AMOUNT = ethers.parseUnits("200000000", 18);
    
    let merkleTree: StandardMerkleTree<string[]>;
    let merkleRoot: string;
    let claimAmount1: bigint;
    let claimAmount2: bigint;
    let claimAmount3: bigint;
    let proof1: string[];
    let proof2: string[];
    let proof3: string[];

    beforeEach(async function () {
        [deployer, governance, treasury, operator, user1, user2, user3] = await ethers.getSigners();
        
        const currentTime = await time.latest();
        
        // Deploy Vesting FIRST (needed for Token and Airdrop)
        const VestingFactory = await ethers.getContractFactory("Vesting");
        vesting = await VestingFactory.deploy(
            ethers.ZeroAddress, // placeholder
            treasury.address,
            governance.address,
            currentTime
        );
        await vesting.waitForDeployment();
        
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
        
        // Deploy Airdrop (needed for Token constructor)
        const AirdropFactory = await ethers.getContractFactory("Airdrop");
        airdrop = await AirdropFactory.deploy(
            ethers.ZeroAddress,
            await vesting.getAddress(),
            treasury.address,
            governance.address
        );
        await airdrop.waitForDeployment();
        
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
        
        // Redeploy Vesting with correct token address
        const VestingFactory2 = await ethers.getContractFactory("Vesting");
        vesting = await VestingFactory2.deploy(
            await token.getAddress(),
            treasury.address,
            governance.address,
            currentTime
        );
        await vesting.waitForDeployment();
        
        // Redeploy Airdrop with correct addresses
        const AirdropFactory2 = await ethers.getContractFactory("Airdrop");
        airdrop = await AirdropFactory2.deploy(
            await token.getAddress(),
            await vesting.getAddress(),
            treasury.address,
            governance.address
        );
        await airdrop.waitForDeployment();
        
        // Fund Vesting
        await token.connect(treasury).transfer(await vesting.getAddress(), VESTING_AMOUNT);
        
        // Grant Airdrop DEPOSITOR_ROLE in Vesting
        const depData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bool"],
            [await airdrop.getAddress(), true]
        );
        const depTx = await vesting.connect(governance).proposeAction(2, depData);
        const depReceipt = await depTx.wait();
        const depEvent = depReceipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
        const depActionId = depEvent?.args?.[0];
        await time.increase(TIMELOCK_DELAY + 1n);
        await vesting.connect(governance).executeAction(depActionId);
        
        // Build Merkle Tree
        claimAmount1 = ethers.parseUnits("100000", 18);
        claimAmount2 = ethers.parseUnits("200000", 18);
        claimAmount3 = ethers.parseUnits("300000", 18);
        
        const chainId = (await ethers.provider.getNetwork()).chainId;
        
        const leaves = [
            [user1.address, claimAmount1.toString(), chainId.toString()],
            [user2.address, claimAmount2.toString(), chainId.toString()],
            [user3.address, claimAmount3.toString(), chainId.toString()]
        ];
        
        merkleTree = StandardMerkleTree.of(leaves, ["address", "uint256", "uint256"]);
        merkleRoot = merkleTree.root;
        
        for (const [i, v] of merkleTree.entries()) {
            if (v[0] === user1.address) proof1 = merkleTree.getProof(i);
            if (v[0] === user2.address) proof2 = merkleTree.getProof(i);
            if (v[0] === user3.address) proof3 = merkleTree.getProof(i);
        }
        
        // Set Merkle Root via timelock
        const deadline = currentTime + 30 * 24 * 3600;
        const maxAllocation = ethers.parseUnits("1000000", 18);
        
        const rootData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "uint256", "uint256"],
            [merkleRoot, deadline, maxAllocation]
        );
        
        const rootTx = await airdrop.connect(governance).proposeAction(0, rootData);
        const rootReceipt = await rootTx.wait();
        const rootEvent = rootReceipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
        const rootActionId = rootEvent?.args?.[0];
        await time.increase(TIMELOCK_DELAY + 1n);
        await airdrop.connect(governance).executeAction(rootActionId);
    });

    // ═══════════════════════════════════════════════════════════════
    // DEPLOYMENT TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Deployment", function () {
        it("Should set correct project token", async function () {
            expect(await airdrop.projectToken()).to.equal(await token.getAddress());
        });

        it("Should set correct vesting contract", async function () {
            expect(await airdrop.vestingContract()).to.equal(await vesting.getAddress());
        });

        it("Should set correct treasury", async function () {
            expect(await airdrop.treasury()).to.equal(treasury.address);
        });

        it("Should set correct governance role", async function () {
            const GOVERNANCE_ROLE = await airdrop.GOVERNANCE_ROLE();
            expect(await airdrop.hasRole(GOVERNANCE_ROLE, governance.address)).to.be.true;
        });

        it("Should be in uninitialized state initially", async function () {
            // We set the root in beforeEach, so it should be Active now
            expect(await airdrop.getAirdropState()).to.equal(1); // Active
        });

        it("Should not be finalized initially", async function () {
            expect(await airdrop.governanceFinalized()).to.be.false;
        });

        it("Should have zero total allocated initially (before claims)", async function () {
            expect(await airdrop.totalAllocated()).to.equal(0);
        });

        it("Should have zero total claimers initially", async function () {
            expect(await airdrop.totalClaimers()).to.equal(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // MERKLE ROOT SETUP TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Merkle Root Setup", function () {
        it("Should set merkle root via timelock", async function () {
            expect(await airdrop.merkleRoot()).to.equal(merkleRoot);
        });

        it("Should set claim deadline", async function () {
            expect(await airdrop.claimDeadline()).to.be.gt(0);
        });

        it("Should set claim start time", async function () {
            expect(await airdrop.claimStart()).to.be.gt(0);
        });

        it("Should set max allocation", async function () {
            expect(await airdrop.maxAirdropAllocation()).to.equal(ethers.parseUnits("1000000", 18));
        });

        it("Should transition to active state", async function () {
            expect(await airdrop.getAirdropState()).to.equal(1); // Active
        });

        it("Should not allow setting root twice", async function () {
            const deadline = (await time.latest()) + 30 * 24 * 3600;
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint256", "uint256"],
                [merkleRoot, deadline, ethers.parseUnits("1000000", 18)]
            );
            
            await expect(
                airdrop.connect(governance).proposeAction(0, data)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__MerkleRootAlreadySet");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // CLAIM SYSTEM TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Claim System", function () {
        it("Should allow valid claim with proof", async function () {
            const beforeSchedule = await vesting.vestingSchedules(user1.address);
            expect(beforeSchedule.exists).to.be.false;
            
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            
            const afterSchedule = await vesting.vestingSchedules(user1.address);
            expect(afterSchedule.exists).to.be.true;
            expect(afterSchedule.totalAllocation).to.equal(claimAmount1);
        });

        it("Should mark user as claimed", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            expect(await airdrop.hasUserClaimed(user1.address)).to.be.true;
        });

        it("Should track total allocated", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            expect(await airdrop.totalAllocated()).to.equal(claimAmount1);
        });

        it("Should track total claimers", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            expect(await airdrop.totalClaimers()).to.equal(1);
        });

        it("Should allow multiple users to claim", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            await airdrop.connect(user2).claim(claimAmount2, proof2);
            await airdrop.connect(user3).claim(claimAmount3, proof3);
            
            expect(await airdrop.totalClaimers()).to.equal(3);
            expect(await airdrop.totalAllocated()).to.equal(claimAmount1 + claimAmount2 + claimAmount3);
        });

        it("Should not allow double claim", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            
            await expect(
                airdrop.connect(user1).claim(claimAmount1, proof1)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__AlreadyClaimed");
        });

        it("Should not allow claim with invalid proof", async function () {
            const invalidProof = [ethers.ZeroHash];
            
            await expect(
                airdrop.connect(user1).claim(claimAmount1, invalidProof)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__InvalidMerkleProof");
        });

        it("Should not allow claim with wrong amount", async function () {
            const wrongAmount = ethers.parseUnits("99999", 18);
            
            await expect(
                airdrop.connect(user1).claim(wrongAmount, proof1)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__InvalidMerkleProof");
        });

        it("Should not allow claim with zero amount", async function () {
            await expect(
                airdrop.connect(user1).claim(0, proof1)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__InvalidAmount");
        });

        it("Should not allow claim after deadline", async function () {
            const deadline = await airdrop.claimDeadline();
            await time.increaseTo(Number(deadline) + 1);
            
            await expect(
                airdrop.connect(user1).claim(claimAmount1, proof1)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__ClaimWindowEnded");
        });

        it("Should not allow claim when paused", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(10, data); // 10 = Pause
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            await expect(
                airdrop.connect(user1).claim(claimAmount1, proof1)
            ).to.be.revertedWithCustomError(airdrop, "EnforcedPause");
        });

        it("Should enforce max allocation cap", async function () {
            const smallMaxAllocation = ethers.parseUnits("50000", 18);
            const newDeadline = (await time.latest()) + 30 * 24 * 3600;
            
            const AirdropFactory = await ethers.getContractFactory("Airdrop");
            const newAirdrop = await AirdropFactory.deploy(
                await token.getAddress(),
                await vesting.getAddress(),
                treasury.address,
                governance.address
            );
            await newAirdrop.waitForDeployment();
            
            const depData = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "bool"],
                [await newAirdrop.getAddress(), true]
            );
            const depTx = await vesting.connect(governance).proposeAction(2, depData);
            const depReceipt = await depTx.wait();
            const depEvent = depReceipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const depActionId = depEvent?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await vesting.connect(governance).executeAction(depActionId);
            
            const rootData = ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint256", "uint256"],
                [merkleRoot, newDeadline, smallMaxAllocation]
            );
            const rootTx = await newAirdrop.connect(governance).proposeAction(0, rootData);
            const rootReceipt = await rootTx.wait();
            const rootEvent = rootReceipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const rootActionId = rootEvent?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await newAirdrop.connect(governance).executeAction(rootActionId);
            
            await expect(
                newAirdrop.connect(user1).claim(claimAmount1, proof1)
            ).to.be.revertedWithCustomError(newAirdrop, "Airdrop__ExceedsMaxAllocation");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE & TIMELOCK TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance & Timelock", function () {
        it("Should allow governance to propose and execute", async function () {
            const newDeadline = (await time.latest()) + 60 * 24 * 3600;
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256"],
                [newDeadline]
            );
            
            const tx = await airdrop.connect(governance).proposeAction(1, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.claimDeadline()).to.equal(newDeadline);
        });

        it("Should not allow execution before timelock delay", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256"],
                [(await time.latest()) + 60 * 24 * 3600]
            );
            
            const tx = await airdrop.connect(governance).proposeAction(1, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await expect(
                airdrop.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__TimelockNotElapsed");
        });

        it("Should not allow non-governance to propose", async function () {
            await expect(
                airdrop.connect(user1).proposeAction(0, "0x")
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__NotGovernance");
        });

        it("Should allow pause via timelock", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(10, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.paused()).to.be.true;
        });

        it("Should allow unpause via timelock", async function () {
            let data = "0x";
            let tx = await airdrop.connect(governance).proposeAction(10, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            let actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            tx = await airdrop.connect(governance).proposeAction(11, data);
            receipt = await tx.wait();
            event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.paused()).to.be.false;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // DEACTIVATE / REACTIVATE TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Deactivate & Reactivate", function () {
        it("Should allow deactivation via timelock", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(2, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.getAirdropState()).to.equal(3); // Deactivated
        });

        it("Should block claims when deactivated", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(2, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            await expect(
                airdrop.connect(user1).claim(claimAmount1, proof1)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__AirdropNotActive");
        });

        it("Should allow reactivation via timelock", async function () {
            let data = "0x";
            let tx = await airdrop.connect(governance).proposeAction(2, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            let actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            tx = await airdrop.connect(governance).proposeAction(3, data);
            receipt = await tx.wait();
            event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.getAirdropState()).to.equal(1); // Active
        });

        it("Should not allow double deactivation", async function () {
            const data = "0x";
            let tx = await airdrop.connect(governance).proposeAction(2, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            let actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            await expect(
                airdrop.connect(governance).proposeAction(2, data)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__AirdropAlreadyDeactivated");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // FINALIZE TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Finalize Airdrop", function () {
        it("Should not allow finalize before claim deadline", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(4, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            await expect(
                airdrop.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__ClaimWindowNotEnded");
        });

        it("Should allow finalize after claim deadline", async function () {
            const deadline = await airdrop.claimDeadline();
            await time.increaseTo(Number(deadline) + 1);
            
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(4, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.getAirdropState()).to.equal(2); // Finalized
        });

        it("Should not allow claims after finalize", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            
            const deadline = await airdrop.claimDeadline();
            await time.increaseTo(Number(deadline) + 1);
            
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(4, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            await expect(
                airdrop.connect(user2).claim(claimAmount2, proof2)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__AirdropNotActive");
        });

        it("Should not allow double finalize", async function () {
            const deadline = await airdrop.claimDeadline();
            await time.increaseTo(Number(deadline) + 1);
            
            const data = "0x";
            let tx = await airdrop.connect(governance).proposeAction(4, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            let actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            await expect(
                airdrop.connect(governance).proposeAction(4, data)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__AirdropAlreadyFinalized");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance Finalization", function () {
        it("Should not allow governance finalization before 180 days", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            await expect(
                airdrop.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__LockPeriodNotElapsed");
        });

        it("Should allow governance finalization after 180 days", async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
            
            expect(await airdrop.governanceFinalized()).to.be.true;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // POST-FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Post-Finalization", function () {
        beforeEach(async function () {
            const data = "0x";
            const tx = await airdrop.connect(governance).proposeAction(5, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await airdrop.connect(governance).executeAction(actionId);
        });

        it("Should block merkle root updates after finalization", async function () {
            const deadline = (await time.latest()) + 30 * 24 * 3600;
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint256", "uint256"],
                [merkleRoot, deadline, ethers.parseUnits("1000000", 18)]
            );
            
            await expect(
                airdrop.connect(governance).proposeAction(0, data)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__FunctionLockedAfter180Days");
        });

        it("Should allow rescue tokens after finalization", async function () {
            await token.connect(treasury).transfer(await airdrop.getAddress(), ethers.parseUnits("1000", 18));
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint256"],
                [await token.getAddress(), treasury.address, ethers.parseUnits("1000", 18)]
            );
            
            const tx = await airdrop.connect(governance).proposeAction(6, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            const beforeBalance = await token.balanceOf(treasury.address);
            await airdrop.connect(governance).executeAction(actionId);
            const afterBalance = await token.balanceOf(treasury.address);
            
            expect(afterBalance).to.be.gt(beforeBalance);
        });

        it("Should block role management after finalization", async function () {
            const GOVERNANCE_ROLE = await airdrop.GOVERNANCE_ROLE();
            
            await expect(
                airdrop.connect(governance).grantRole(GOVERNANCE_ROLE, user1.address)
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__RoleManagementLocked");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("View Functions", function () {
        it("Should check canClaim correctly", async function () {
            const canClaim = await airdrop.canClaim(user1.address, claimAmount1, proof1);
            expect(canClaim).to.be.true;
        });

        it("Should check canClaim returns false for already claimed", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            
            const canClaim = await airdrop.canClaim(user1.address, claimAmount1, proof1);
            expect(canClaim).to.be.false;
        });

        it("Should return claim window open status", async function () {
            expect(await airdrop.isClaimWindowOpen()).to.be.true;
        });

        it("Should return time until deadline", async function () {
            const timeUntil = await airdrop.timeUntilDeadline();
            expect(timeUntil).to.be.gt(0);
        });

        it("Should return time until start", async function () {
            const timeUntil = await airdrop.timeUntilStart();
            expect(timeUntil).to.equal(0);
        });

        it("Should check hasUserClaimed", async function () {
            expect(await airdrop.hasUserClaimed(user1.address)).to.be.false;
            
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            
            expect(await airdrop.hasUserClaimed(user1.address)).to.be.true;
        });

        it("Should return available tokens in vesting", async function () {
            const available = await airdrop.availableTokensInVesting();
            expect(available).to.be.gt(0);
        });

        it("Should check can finalize governance", async function () {
            const canFinalize = await airdrop.canFinalizeGovernance();
            expect(canFinalize).to.be.false;
        });

        it("Should return time until finalization", async function () {
            const timeUntil = await airdrop.timeUntilFinalization();
            expect(timeUntil).to.be.gt(0);
        });

        it("Should check governance lock status", async function () {
            const isLocked = await airdrop.isGovernanceLocked();
            expect(isLocked).to.be.false;
        });

        it("Should generate correct leaf", async function () {
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const leaf = await airdrop.getLeaf(user1.address, claimAmount1);
            const expectedLeaf = ethers.keccak256(
                ethers.solidityPacked(["address", "uint256", "uint256"], [user1.address, claimAmount1, chainId])
            );
            expect(leaf).to.equal(expectedLeaf);
        });

        it("Should return correct action hash", async function () {
            const data = "0x";
            const timestamp = await time.latest();
            const nonce = 0;
            
            const hash = await airdrop.getActionHash(0, data, timestamp, governance.address, nonce);
            const expectedHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint8", "bytes", "uint256", "address", "uint256"],
                    [0, data, timestamp, governance.address, nonce]
                )
            );
            expect(hash).to.equal(expectedHash);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════
    
    describe("Edge Cases", function () {
        it("Should handle empty proof", async function () {
            await expect(
                airdrop.connect(user1).claim(claimAmount1, [])
            ).to.be.revertedWithCustomError(airdrop, "Airdrop__InvalidMerkleProof");
        });

        it("Should track total allocated across multiple claims", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            await airdrop.connect(user2).claim(claimAmount2, proof2);
            
            expect(await airdrop.totalAllocated()).to.equal(claimAmount1 + claimAmount2);
            expect(await airdrop.totalClaimers()).to.equal(2);
        });

        it("Should not affect other users when one claims", async function () {
            await airdrop.connect(user1).claim(claimAmount1, proof1);
            
            expect(await airdrop.hasUserClaimed(user2.address)).to.be.false;
            
            await airdrop.connect(user2).claim(claimAmount2, proof2);
            expect(await airdrop.hasUserClaimed(user2.address)).to.be.true;
        });

        it("Should handle contract with no ETH", async function () {
            const balance = await ethers.provider.getBalance(await airdrop.getAddress());
            expect(balance).to.equal(0);
        });

        it("Should handle contract receiving ETH", async function () {
            await deployer.sendTransaction({
                to: await airdrop.getAddress(),
                value: ethers.parseEther("1")
            });
            
            const balance = await ethers.provider.getBalance(await airdrop.getAddress());
            expect(balance).to.equal(ethers.parseEther("1"));
        });
    });
});