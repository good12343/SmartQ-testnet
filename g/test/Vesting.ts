// test/Vesting.test.ts (الإصدار النهائي المُصحَّح)
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Vesting, ERC20Mock } from "../typechain-types";

describe("Vesting Contract", function () {
  let vesting: Vesting;
  let projectToken: ERC20Mock;

  let owner: SignerWithAddress;
  let governance: SignerWithAddress;
  let depositor: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let treasury: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;

  const TOTAL_SUPPLY_CAP = ethers.parseEther("1000000000");
  const CLIFF_PERIOD = 180 * 24 * 60 * 60;
  const MONTHLY_INTERVAL = 30 * 24 * 60 * 60;
  const TRANCHE_PERCENTAGE = 2500n;
  const ALLOCATION_AMOUNT = ethers.parseEther("10000");

  let projectLaunchTime: number;

  async function deployContracts() {
    const latestBlock = await ethers.provider.getBlock("latest");
    projectLaunchTime = latestBlock!.timestamp + 1000;

    const ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
    projectToken = await ERC20MockFactory.deploy("Project Token", "PRJ");

    const VestingFactory = await ethers.getContractFactory("Vesting");
    vesting = await VestingFactory.deploy(
      await projectToken.getAddress(),
      treasury.address,
      governance.address,
      projectLaunchTime
    );

    await projectToken.mint(depositor.address, ethers.parseEther("1000000"));
    await projectToken.mint(governance.address, ethers.parseEther("1000000"));
    await projectToken.connect(depositor).approve(await vesting.getAddress(), ethers.MaxUint256);
    await projectToken.connect(governance).approve(await vesting.getAddress(), ethers.MaxUint256);

    const DEPOSITOR_ROLE = await vesting.DEPOSITOR_ROLE();
    await vesting.connect(governance).grantRole(DEPOSITOR_ROLE, depositor.address);
  }

  async function advancePastCliff() {
    await time.increaseTo(projectLaunchTime + CLIFF_PERIOD + 1);
  }

  async function advanceMonths(months: number) {
    await time.increase(MONTHLY_INTERVAL * months);
  }

  beforeEach(async function () {
    [owner, governance, depositor, user1, user2, treasury, unauthorizedUser] = await ethers.getSigners();
    await deployContracts();
  });

  // ==================== Deployment ====================
  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await vesting.projectToken()).to.equal(await projectToken.getAddress());
      expect(await vesting.treasury()).to.equal(treasury.address);
      expect(await vesting.projectLaunchTime()).to.equal(projectLaunchTime);
      expect(await vesting.governanceFinalized()).to.equal(false);
      expect(await vesting.totalAllocated()).to.equal(0);
      expect(await vesting.totalClaimedAmount()).to.equal(0);
    });

    it("Should grant GOVERNANCE_ROLE to governance address", async function () {
      const GOVERNANCE_ROLE = await vesting.GOVERNANCE_ROLE();
      expect(await vesting.hasRole(GOVERNANCE_ROLE, governance.address)).to.equal(true);
    });

    it("Should revert if projectToken is zero address", async function () {
      const VestingFactory = await ethers.getContractFactory("Vesting");
      await expect(
        VestingFactory.deploy(ethers.ZeroAddress, treasury.address, governance.address, projectLaunchTime)
      ).to.be.revertedWithCustomError(vesting, "Vesting__ZeroAddress");
    });
  });

  // ==================== Deposits and Allocations ====================
  describe("Deposits and Allocations", function () {
    it("Should allow depositor to deposit tokens", async function () {
      const depositAmount = ethers.parseEther("5000");
      await expect(vesting.connect(depositor).depositTokens(depositAmount))
        .to.emit(vesting, "TokensDeposited")
        .withArgs(depositor.address, depositAmount);
      expect(await projectToken.balanceOf(await vesting.getAddress())).to.equal(depositAmount);
    });

    it("Should revert deposit with zero amount", async function () {
      await expect(vesting.connect(depositor).depositTokens(0))
        .to.be.revertedWithCustomError(vesting, "Vesting__InvalidAmount");
    });

    it("Should allocate tokens to user after deposit", async function () {
      const amount = ethers.parseEther("10000");
      // ✅ Fix: deposit first then allocate
      await vesting.connect(depositor).depositTokens(amount);
      await expect(vesting.connect(depositor).allocate(user1.address, amount))
        .to.emit(vesting, "TokensAllocated")
        .withArgs(user1.address, amount, projectLaunchTime);

      const schedule = await vesting.vestingSchedules(user1.address);
      expect(schedule.totalAllocation).to.equal(amount);
      expect(schedule.exists).to.equal(true);
      expect(await vesting.totalAllocated()).to.equal(amount);
    });

    it("Should deposit and allocate in single transaction", async function () {
      const amount = ethers.parseEther("10000");
      await vesting.connect(depositor).depositAndAllocate(user1.address, amount);
      const schedule = await vesting.vestingSchedules(user1.address);
      expect(schedule.totalAllocation).to.equal(amount);
      expect(await projectToken.balanceOf(await vesting.getAddress())).to.equal(amount);
    });

    it("Should batch allocate to multiple users", async function () {
      const users = [user1.address, user2.address];
      const amounts = [ethers.parseEther("5000"), ethers.parseEther("3000")];
      await vesting.connect(depositor).depositTokens(ethers.parseEther("8000"));
      await expect(vesting.connect(depositor).batchAllocate(users, amounts))
        .to.emit(vesting, "TokensAllocated");
      expect((await vesting.vestingSchedules(user1.address)).totalAllocation).to.equal(amounts[0]);
      expect((await vesting.vestingSchedules(user2.address)).totalAllocation).to.equal(amounts[1]);
    });

    it("Should revert allocation if user already has allocation", async function () {
      // ✅ Fix: ensure balance before first allocation
      await vesting.connect(depositor).depositTokens(ALLOCATION_AMOUNT);
      await vesting.connect(depositor).allocate(user1.address, ALLOCATION_AMOUNT);
      await expect(
        vesting.connect(depositor).allocate(user1.address, ALLOCATION_AMOUNT)
      ).to.be.revertedWithCustomError(vesting, "Vesting__AllocationAlreadyExists");
    });

    it("Should revert if total allocation exceeds cap", async function () {
      const hugeAmount = TOTAL_SUPPLY_CAP + 1n;
      await projectToken.mint(depositor.address, hugeAmount);
      await projectToken.connect(depositor).approve(await vesting.getAddress(), hugeAmount);
      await expect(
        vesting.connect(depositor).depositAndAllocate(user1.address, hugeAmount)
      ).to.be.revertedWithCustomError(vesting, "Vesting__InvalidAmount");
    });

    it("Should revert if unauthorized user tries to allocate", async function () {
      await expect(
        vesting.connect(unauthorizedUser).allocate(user1.address, ALLOCATION_AMOUNT)
      ).to.be.revertedWithCustomError(vesting, "Vesting__NotAuthorized");
    });
  });

  // ==================== Claiming Tokens ====================
  describe("Claiming Tokens", function () {
    beforeEach(async function () {
      await vesting.connect(depositor).depositAndAllocate(user1.address, ALLOCATION_AMOUNT);
    });

    it("Should revert claim before cliff period", async function () {
  // لا نقوم بتغيير الوقت؛ الوقت الحالي < projectLaunchTime + CLIFF_PERIOD
    await expect(
    vesting.connect(user1).claim()
     ).to.be.revertedWithCustomError(vesting, "Vesting__CliffNotReached");
    });

    it("Should allow claiming first 25% immediately after cliff", async function () {
      await advancePastCliff();
      const firstTranche = (ALLOCATION_AMOUNT * TRANCHE_PERCENTAGE) / 10000n;

      // ✅ Fix: capture timestamp from transaction receipt
      const tx = await vesting.connect(user1).claim();
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const eventTimestamp = block!.timestamp;

      await expect(tx)
        .to.emit(vesting, "TokensClaimed")
        .withArgs(user1.address, firstTranche, eventTimestamp);
      expect(await projectToken.balanceOf(user1.address)).to.equal(firstTranche);
    });

    it("Should allow claiming 50% after cliff + 1 month", async function () {
      await advancePastCliff();
      await vesting.connect(user1).claim();
      await advanceMonths(1);
      const secondTranche = (ALLOCATION_AMOUNT * TRANCHE_PERCENTAGE) / 10000n;

      const tx = await vesting.connect(user1).claim();
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const eventTimestamp = block!.timestamp;

      await expect(tx)
        .to.emit(vesting, "TokensClaimed")
        .withArgs(user1.address, secondTranche, eventTimestamp);
      expect(await projectToken.balanceOf(user1.address)).to.equal(secondTranche * 2n);
    });

    it("Should allow claiming full amount after 3 months post-cliff", async function () {
      await advancePastCliff();
      await advanceMonths(3);
      await vesting.connect(user1).claim();
      expect(await projectToken.balanceOf(user1.address)).to.equal(ALLOCATION_AMOUNT);
    });

    it("Should calculate releasable amount correctly", async function () {
      await advancePastCliff();
      await advanceMonths(1);
      const expectedReleasable = (ALLOCATION_AMOUNT * TRANCHE_PERCENTAGE * 2n) / 10000n;
      const releasable = await vesting.calculateReleasable(user1.address);
      expect(releasable).to.equal(expectedReleasable);
    });

    it("Should return 0 releasable after all tokens claimed", async function () {
      await advancePastCliff();
      await advanceMonths(3);
      await vesting.connect(user1).claim();
      const releasable = await vesting.calculateReleasable(user1.address);
      expect(releasable).to.equal(0);
    });

    it("Should revert claim for non-existent schedule", async function () {
      await advancePastCliff();
      await expect(vesting.connect(user2).claim())
        .to.be.revertedWithCustomError(vesting, "Vesting__NoAllocation");
    });

    it("Should allow claiming even when contract is paused", async function () {
      // ✅ Fix: use a different user to avoid duplicate allocation
      await vesting.connect(depositor).depositAndAllocate(user2.address, ALLOCATION_AMOUNT);

      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await vesting.connect(governance).proposeAction(4, data); // Pause
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await vesting.connect(governance).executeAction(actionId!);

      await advancePastCliff();
      await expect(vesting.connect(user2).claim()).to.emit(vesting, "TokensClaimed");
    });
  });

  // ==================== Timelock Governance ====================
  describe("Timelock Governance", function () {
    it("Should propose and execute allocate action", async function () {
      const fundAmount = ethers.parseEther("10000");
      await vesting.connect(governance).depositTokens(fundAmount);

      const amount = ethers.parseEther("5000");
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, amount]
      );

      const tx = await vesting.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(vesting.connect(governance).executeAction(actionId!))
        .to.emit(vesting, "ActionExecuted");

      const schedule = await vesting.vestingSchedules(user1.address);
      expect(schedule.totalAllocation).to.equal(amount);
    });

    it("Should revert if non-governance tries to propose action", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      await expect(
        vesting.connect(unauthorizedUser).proposeAction(5, data)
      ).to.be.revertedWithCustomError(vesting, "Vesting__NotGovernance");
    });

    it("Should revert execution before timelock period", async function () {
      await vesting.connect(governance).depositTokens(ethers.parseEther("10000"));
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, ethers.parseEther("5000")]
      );
      const tx = await vesting.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await expect(
        vesting.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(vesting, "Vesting__TimelockNotElapsed");
    });

    it("Should revert execution after grace period", async function () {
      await vesting.connect(governance).depositTokens(ethers.parseEther("10000"));
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, ethers.parseEther("5000")]
      );
      const tx = await vesting.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 7 * 24 * 60 * 60 + 1);
      await expect(
        vesting.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(vesting, "Vesting__ActionExpired");
    });

    it("Should prevent double execution", async function () {
      await vesting.connect(governance).depositTokens(ethers.parseEther("10000"));
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, ethers.parseEther("5000")]
      );
      const tx = await vesting.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await vesting.connect(governance).executeAction(actionId!);
      await expect(
        vesting.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(vesting, "Vesting__AlreadyFinalized");
    });
  });

  // ==================== Governance Finalization ====================
  describe("Governance Finalization", function () {
    it("Should revert finalization before 180 days", async function () {
      await time.increase(100 * 24 * 60 * 60); // 100 days < 180
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      // proposal is allowed, but execution should fail
      const tx = await vesting.connect(governance).proposeAction(6, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        vesting.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(vesting, "Vesting__LockPeriodNotElapsed");
    });

    it("Should allow finalization after 180 days (before auto-lock if not yet locked)", async function () {
      // governance auto-locks at 180 days, so finalization must be proposed and executed exactly at/after 180 days
      // but before execution the check `_isGovernanceLocked()` will see if 180 days have passed,
      // and finalization is allowed only if not already locked.
      // Actually finalizeGovernance can be called even after 180 days? The code:
      // function _finalizeGovernance() internal {
      //   if (block.timestamp < governanceStartTime + GOVERNANCE_LOCK_PERIOD) revert Vesting__LockPeriodNotElapsed();
      //   governanceFinalized = true;
      // }
      // So it just checks that 180 days have passed. It doesn't check if already locked.
      // But the proposeAction check: if _isGovernanceLocked() then only WithdrawExpired, RescueTokens, RescueEth are allowed.
      // Since _isGovernanceLocked() returns true if governanceFinalized OR block.timestamp >= governanceStartTime + 180 days.
      // So after 180 days, proposing FinalizeGovernance is blocked.
      // Therefore we cannot finalize after 180 days. The only way to finalize is to propose before 180 days and execute after 180 days.
      // Let's test that scenario.
      
      // Prepare proposal just before 180 days (179 days)
      await time.increase(179 * 24 * 60 * 60);
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await vesting.connect(governance).proposeAction(6, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];

      // Now advance to after 180 days + timelock
      await time.increase(1 * 24 * 60 * 60 + 48 * 60 * 60 + 1); // 1 day + 48h
      await expect(vesting.connect(governance).executeAction(actionId!))
        .to.emit(vesting, "GovernanceFinalized");
      expect(await vesting.governanceFinalized()).to.equal(true);
    });

    it("Should auto-lock roles after 180 days", async function () {
      await time.increase(180 * 24 * 60 * 60 + 1);
      await expect(
        vesting.connect(governance).grantRole(await vesting.DEPOSITOR_ROLE(), unauthorizedUser.address)
      ).to.be.revertedWithCustomError(vesting, "Vesting__RoleManagementLocked");
    });

    it("Should revert finalization proposal after 180 days (auto-locked)", async function () {
      await time.increase(180 * 24 * 60 * 60 + 1);
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      await expect(
        vesting.connect(governance).proposeAction(6, data)
      ).to.be.revertedWithCustomError(vesting, "Vesting__FunctionLockedAfter180Days");
    });
  });

  // ==================== Expired Tokens Withdrawal ====================
  describe("Expired Tokens Withdrawal", function () {
    beforeEach(async function () {
      await vesting.connect(depositor).depositAndAllocate(user1.address, ALLOCATION_AMOUNT);
    });

    it("Should allow withdrawal after claim expiration", async function () {
      await time.increase(1095 * 24 * 60 * 60 + 1);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address]);
      const tx = await vesting.connect(governance).proposeAction(7, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(vesting.connect(governance).executeAction(actionId!))
        .to.emit(vesting, "ExpiredTokensWithdrawn")
        .withArgs(user1.address, ALLOCATION_AMOUNT, treasury.address);
      expect(await projectToken.balanceOf(treasury.address)).to.equal(ALLOCATION_AMOUNT);
    });

    it("Should revert withdrawal before expiration", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address]);
      const tx = await vesting.connect(governance).proposeAction(7, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        vesting.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(vesting, "Vesting__NotExpiredYet");
    });
  });

  // ==================== Token Rescue ====================
  describe("Token Rescue", function () {
    it("Should rescue excess tokens", async function () {
      const extraAmount = ethers.parseEther("1000");
      await projectToken.mint(governance.address, extraAmount);
      await projectToken.connect(governance).transfer(await vesting.getAddress(), extraAmount);

      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256"],
        [await projectToken.getAddress(), treasury.address, extraAmount]
      );
      const tx = await vesting.connect(governance).proposeAction(8, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(vesting.connect(governance).executeAction(actionId!))
        .to.emit(vesting, "TokensRescued");
    });

    it("Should not allow rescuing reserved tokens", async function () {
      await vesting.connect(depositor).depositAndAllocate(user1.address, ALLOCATION_AMOUNT);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256"],
        [await projectToken.getAddress(), treasury.address, ALLOCATION_AMOUNT]
      );
      const tx = await vesting.connect(governance).proposeAction(8, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        vesting.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(vesting, "Vesting__InvalidAmount");
    });
  });

  // ==================== View Functions ====================
  describe("View Functions", function () {
    it("Should return correct reserved tokens", async function () {
      const amount = ethers.parseEther("10000");
      await vesting.connect(depositor).depositAndAllocate(user1.address, amount);
      await advancePastCliff();
      await advanceMonths(1);
      await vesting.connect(user1).claim();
      const claimed = (amount * TRANCHE_PERCENTAGE * 2n) / 10000n;
      expect(await vesting.getReservedTokens()).to.equal(amount - claimed);
    });

    it("Should return correct excess tokens", async function () {
      const allocated = ethers.parseEther("10000");
      const extra = ethers.parseEther("5000");
      await vesting.connect(depositor).depositAndAllocate(user1.address, allocated);
      await projectToken.mint(governance.address, extra);
      await projectToken.connect(governance).transfer(await vesting.getAddress(), extra);
      expect(await vesting.getExcessTokens()).to.equal(extra);
    });
  });

  // ==================== ETH Rescue ====================
  describe("ETH Rescue", function () {
    it("Should rescue ETH from contract", async function () {
      await owner.sendTransaction({
        to: await vesting.getAddress(),
        value: ethers.parseEther("1"),
      });
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [treasury.address]);
      const tx = await vesting.connect(governance).proposeAction(9, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      const initialBalance = await ethers.provider.getBalance(treasury.address);
      await expect(vesting.connect(governance).executeAction(actionId!))
        .to.emit(vesting, "EthRescued");
      const finalBalance = await ethers.provider.getBalance(treasury.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1"));
    });
  });
});