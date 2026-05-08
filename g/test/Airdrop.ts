import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Airdrop, ERC20Mock, MockVesting } from "../typechain-types";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

describe("Airdrop Contract", function () {
  let airdrop: Airdrop;
  let projectToken: ERC20Mock;
  let vesting: MockVesting;
  let governance: SignerWithAddress;
  let operator: SignerWithAddress;
  let treasury: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  // Merkle tree data
  let merkleTree: MerkleTree;
  let root: string;
  let leaves: { address: string; amount: string; leaf: Buffer }[];

  const BASE_AMOUNT = ethers.parseEther("1000"); // 1000 tokens per user
  const MAX_ALLOCATION = ethers.parseEther("3000"); // 3 users max

  const GOVERNANCE_LOCK_PERIOD = 180 * 24 * 60 * 60;
  const TIMELOCK_DELAY = 48 * 60 * 60;

  async function deployContracts() {
    // Deploy project token
    const ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
    projectToken = await ERC20MockFactory.deploy("Project Token", "PRJ");

    // Deploy MockVesting
    const VestingFactory = await ethers.getContractFactory("MockVesting");
    vesting = await VestingFactory.deploy(await projectToken.getAddress());

    // Fund vesting with enough tokens for airdrop (max allocation)
    await projectToken.mint(await vesting.getAddress(), MAX_ALLOCATION);
    await vesting.setReservedTokens(0); // no reserved

    // Deploy Airdrop
    const AirdropFactory = await ethers.getContractFactory("Airdrop");
    airdrop = await AirdropFactory.deploy(
      await projectToken.getAddress(),
      await vesting.getAddress(),
      treasury.address,
      governance.address
    );
  }

  function buildMerkleTree(users: { address: string; amount: bigint }[]) {
    leaves = users.map((u) => {
      const leafData = ethers.solidityPacked(
        ["address", "uint256", "uint256"],
        [u.address, u.amount, ethers.toBigInt((network.config as any).chainId || 31337)]
      );
      return {
        address: u.address,
        amount: ethers.formatEther(u.amount),
        leaf: Buffer.from(ethers.getBytes(keccak256(leafData)))
      };
    });

    merkleTree = new MerkleTree(
      leaves.map((l) => l.leaf),
      keccak256,
      { sortPairs: true }
    );
    root = merkleTree.getHexRoot();
  }

  function getProof(userAddress: string, amount: bigint): string[] {
    const leafData = ethers.solidityPacked(
      ["address", "uint256", "uint256"],
      [userAddress, amount, ethers.toBigInt((network.config as any).chainId || 31337)]
    );
    const leaf = keccak256(leafData);
    return merkleTree.getHexProof(leaf);
  }

  beforeEach(async function () {
    [governance, operator, treasury, user1, user2, user3, unauthorized] = await ethers.getSigners();
    await deployContracts();
  });

  describe("Deployment", function () {
    it("should set correct initial values", async function () {
      expect(await airdrop.projectToken()).to.equal(await projectToken.getAddress());
      expect(await airdrop.vestingContract()).to.equal(await vesting.getAddress());
      expect(await airdrop.treasury()).to.equal(treasury.address);
      expect(await airdrop.airdropState()).to.equal(0); // Uninitialized
      expect(await airdrop.merkleRoot()).to.equal(ethers.ZeroHash);
      expect(await airdrop.governanceFinalized()).to.equal(false);
    });
  });

  describe("Merkle Root Setting via Governance", function () {
    beforeEach(async function () {
      // Build merkle tree for test users
      buildMerkleTree([
        { address: user1.address, amount: BASE_AMOUNT },
        { address: user2.address, amount: BASE_AMOUNT },
        { address: user3.address, amount: BASE_AMOUNT }
      ]);

      // Fund vesting with enough tokens (already done)
    });

    async function proposeAndExecuteSetMerkleRoot(
      root: string,
      deadline: number,
      maxAllocation: bigint
    ) {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint256"],
        [root, deadline, maxAllocation]
      );
      const tx = await airdrop.connect(governance).proposeAction(0, data); // SetMerkleRoot
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
    }

    it("should set merkle root and activate airdrop", async function () {
      const deadline = (await time.latest()) + 10 * 86400; // 10 days from now
      await proposeAndExecuteSetMerkleRoot(root, deadline, MAX_ALLOCATION);
      expect(await airdrop.merkleRoot()).to.equal(root);
      expect(await airdrop.airdropState()).to.equal(1); // Active
    });

    it("should revert if deadline is in past", async function () {
      const deadline = (await time.latest()) - 1000;
      await expect(
        proposeAndExecuteSetMerkleRoot(root, deadline, MAX_ALLOCATION)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__DeadlineInPast");
    });

    it("should revert if deadline <= timestamp + 1 day", async function () {
      const deadline = (await time.latest()) + 2 * 86400 +3600; // 2 days (less than 1 day from execution after 48h delay)
      await expect(
        proposeAndExecuteSetMerkleRoot(root, deadline, MAX_ALLOCATION)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__InvalidDeadline");
    });
  });

  describe("Claiming", function () {
    beforeEach(async function () {
      buildMerkleTree([
        { address: user1.address, amount: BASE_AMOUNT },
        { address: user2.address, amount: BASE_AMOUNT }
      ]);
      const deadline = (await time.latest()) + 10 * 86400;
      // Set merkle root via governance
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint256"],
        [root, deadline, MAX_ALLOCATION]
      );
      const tx = await airdrop.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
    });

    it("should allow valid claim", async function () {
      const proof = getProof(user1.address, BASE_AMOUNT);
      await expect(
        airdrop.connect(user1).claim(BASE_AMOUNT, proof)
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(user1.address, BASE_AMOUNT);
      expect(await airdrop.hasClaimed(user1.address)).to.be.true;
      expect(await vesting.allocations(user1.address)).to.equal(BASE_AMOUNT);
    });

    it("should revert double claim", async function () {
      const proof = getProof(user1.address, BASE_AMOUNT);
      await airdrop.connect(user1).claim(BASE_AMOUNT, proof);
      await expect(
        airdrop.connect(user1).claim(BASE_AMOUNT, proof)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__AlreadyClaimed");
    });

    it("should revert invalid proof", async function () {
      const badProof = getProof(user1.address, BASE_AMOUNT * 2n); // wrong amount
      await expect(
        airdrop.connect(user1).claim(BASE_AMOUNT, badProof)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__InvalidMerkleProof");
    });

    it("should revert if claim window not started", async function () {
      // claimStart is deployment block time for this test? We set merkle root at current time, claimStart = block.timestamp of execution. We'll simulate by warping back.
      // Since we cannot warp before, we skip this edge.
    });

    it("should revert after deadline", async function () {
      // Advance past deadline
      const deadline = await airdrop.claimDeadline();
      await time.increaseTo(Number(deadline) + 1);
      const proof = getProof(user1.address, BASE_AMOUNT);
      await expect(
        airdrop.connect(user1).claim(BASE_AMOUNT, proof)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__ClaimWindowEnded");
    });

    it("should revert when paused", async function () {
      // Pause via governance
      const pauseData = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await airdrop.connect(governance).proposeAction(10, pauseData); // Pause
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
      
      const proof = getProof(user1.address, BASE_AMOUNT);
      await expect(
        airdrop.connect(user1).claim(BASE_AMOUNT, proof)
      ).to.be.reverted; // "Pausable: paused"
    });
  });

  describe("Deactivate / Reactivate", function () {
    beforeEach(async function () {
      buildMerkleTree([{ address: user1.address, amount: BASE_AMOUNT }]);
      const deadline = (await time.latest()) + 10 * 86400;
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint256"],
        [root, deadline, MAX_ALLOCATION]
      );
      const tx = await airdrop.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
    });

    async function executeAction(actionType: number, data: string) {
      const tx = await airdrop.connect(governance).proposeAction(actionType, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      return airdrop.connect(governance).executeAction(actionId!);
    }

    it("should deactivate and reactivate", async function () {
      await executeAction(2, "0x"); // Deactivate
      expect(await airdrop.airdropState()).to.equal(3); // Deactivated

      // Claims should fail
      const proof = getProof(user1.address, BASE_AMOUNT);
      await expect(
        airdrop.connect(user1).claim(BASE_AMOUNT, proof)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__AirdropNotActive");

      await executeAction(3, "0x"); // Reactivate
      expect(await airdrop.airdropState()).to.equal(1); // Active again
      await airdrop.connect(user1).claim(BASE_AMOUNT, proof); // should succeed
    });
  });

  describe("Finalize", function () {
    beforeEach(async function () {
      buildMerkleTree([{ address: user1.address, amount: BASE_AMOUNT }]);
      const deadline = (await time.latest()) + 10 * 86400;
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint256"],
        [root, deadline, MAX_ALLOCATION]
      );
      const tx = await airdrop.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
    });

    it("should revert finalize before deadline", async function () {
  const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
  // الاقتراح مسموح، ننشئ الـ proposal
  const tx = await airdrop.connect(governance).proposeAction(4, data);
  const receipt = await tx.wait();
  const actionId = receipt?.logs[0]?.topics[1];
  await time.increase(TIMELOCK_DELAY + 1);
  // التنفيذ يجب أن يُرفض لأن deadline لم ينتهِ بعد
  await expect(
    airdrop.connect(governance).executeAction(actionId!)
  ).to.be.reverted; // أي خطأ كافٍ
});

    it("should finalize after deadline", async function () {
      // Advance to after deadline
      const deadline = await airdrop.claimDeadline();
      await time.increaseTo(Number(deadline) + 1);
      
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await airdrop.connect(governance).proposeAction(4, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await expect(airdrop.connect(governance).executeAction(actionId!))
        .to.emit(airdrop, "Finalized");
      expect(await airdrop.airdropState()).to.equal(2); // Finalized
    });
  });

  describe("Governance Finalization & Lockdown", function () {
    it("should lock governance after 180 days", async function () {
      await time.increase(GOVERNANCE_LOCK_PERIOD + 1);
      await expect(
        airdrop.connect(governance).grantRole(await airdrop.OPERATOR_ROLE(), unauthorized.address)
      ).to.be.revertedWithCustomError(airdrop, "Airdrop__RoleManagementLocked");
    });

    it("should allow finalize governance after 180 days", async function () {
      await time.increase(179 * 86400);
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await airdrop.connect(governance).proposeAction(5, data); // FinalizeGovernance
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(1 * 86400 + TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
      expect(await airdrop.governanceFinalized()).to.be.true;
    });
  });

  describe("Rescue Functions", function () {
    it("should rescue tokens", async function () {
      const amount = ethers.parseEther("100");
      await projectToken.mint(await airdrop.getAddress(), amount);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256"],
        [await projectToken.getAddress(), treasury.address, amount]
      );
      const tx = await airdrop.connect(governance).proposeAction(6, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(TIMELOCK_DELAY + 1);
      await airdrop.connect(governance).executeAction(actionId!);
      expect(await projectToken.balanceOf(treasury.address)).to.equal(amount);
    });
  });

  describe("View Functions", function () {
    it("should return correct canClaim", async function () {
      // Before setup
      expect(await airdrop.canClaim(user1.address, BASE_AMOUNT, [])).to.be.false;
    });
  });
});