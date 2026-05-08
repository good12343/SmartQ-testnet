import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Token, Vesting, Sale } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Sale", function () {
    let token: Token;
    let vesting: Vesting;
    let sale: Sale;
    let deployer: SignerWithAddress;
    let governance: SignerWithAddress;
    let treasury: SignerWithAddress;
    let operator: SignerWithAddress;
    let buyer1: SignerWithAddress;
    let buyer2: SignerWithAddress;
    let buyer3: SignerWithAddress;
    
    const GOVERNANCE_LOCK_PERIOD = 180n * 24n * 60n * 60n;
    const TIMELOCK_DELAY = 48n * 60n * 60n;
    
    const TREASURY_AMOUNT = ethers.parseUnits("400000000", 18);
    const VESTING_AMOUNT = ethers.parseUnits("300000000", 18);
    const AIRDROP_AMOUNT = ethers.parseUnits("100000000", 18);
    const SALE_AMOUNT = ethers.parseUnits("200000000", 18);
    
    const TOKEN_PRICE = 1000000;
    const SALE_CAP = ethers.parseUnits("50000000", 18);
    const MIN_PURCHASE = ethers.parseUnits("1000", 18);
    const WALLET_CAP = ethers.parseUnits("10000000", 18);

    beforeEach(async function () {
        [deployer, governance, treasury, operator, buyer1, buyer2, buyer3] = await ethers.getSigners();
        
        const currentTime = await time.latest();
        
        // Deploy Vesting FIRST
        const VestingFactory = await ethers.getContractFactory("Vesting");
        vesting = await VestingFactory.deploy(
            ethers.ZeroAddress,
            treasury.address,
            governance.address,
            currentTime
        );
        await vesting.waitForDeployment();
        
        // Deploy Airdrop placeholder
        const AirdropFactory = await ethers.getContractFactory("Airdrop");
        const airdrop = await AirdropFactory.deploy(
            ethers.ZeroAddress,
            await vesting.getAddress(),
            treasury.address,
            governance.address
        );
        await airdrop.waitForDeployment();
        
        // Deploy Sale
        const saleStart = currentTime + 3600;
        const saleEnd = saleStart + 7 * 24 * 3600;
        
        const SaleFactory = await ethers.getContractFactory("Sale");
        sale = await SaleFactory.deploy(
            ethers.ZeroAddress,
            await vesting.getAddress(),
            treasury.address,
            governance.address,
            TOKEN_PRICE,
            SALE_CAP,
            MIN_PURCHASE,
            saleStart,
            saleEnd
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
        
        // Redeploy Vesting with correct token
        const VestingFactory2 = await ethers.getContractFactory("Vesting");
        vesting = await VestingFactory2.deploy(
            await token.getAddress(),
            treasury.address,
            governance.address,
            currentTime
        );
        await vesting.waitForDeployment();
        
        // Redeploy Sale with correct token
        const SaleFactory2 = await ethers.getContractFactory("Sale");
        sale = await SaleFactory2.deploy(
            await token.getAddress(),
            await vesting.getAddress(),
            treasury.address,
            governance.address,
            TOKEN_PRICE,
            SALE_CAP,
            MIN_PURCHASE,
            saleStart,
            saleEnd
        );
        await sale.waitForDeployment();
        
        // Fund Vesting
        await token.connect(treasury).transfer(await vesting.getAddress(), VESTING_AMOUNT);
        
        // Grant Sale DEPOSITOR_ROLE in Vesting
        const depData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bool"],
            [await sale.getAddress(), true]
        );
        const depTx = await vesting.connect(governance).proposeAction(2, depData);
        const depReceipt = await depTx.wait();
        const depEvent = depReceipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
        const depActionId = depEvent?.args?.[0];
        await time.increase(TIMELOCK_DELAY + 1n);
        await vesting.connect(governance).executeAction(depActionId);
        
        // Start the sale
        const startData = "0x";
        const startTx = await sale.connect(governance).proposeAction(0, startData);
        const startReceipt = await startTx.wait();
        const startEvent = startReceipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
        const startActionId = startEvent?.args?.[0];
        await time.increase(TIMELOCK_DELAY + 1n);
        await sale.connect(governance).executeAction(startActionId);
        
        // Advance time to sale start
        await time.increaseTo(saleStart + 1);
    });

    // ═══════════════════════════════════════════════════════════════
    // DEPLOYMENT TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Deployment", function () {
        it("Should set correct project token", async function () {
            expect(await sale.projectToken()).to.equal(await token.getAddress());
        });

        it("Should set correct vesting contract", async function () {
            expect(await sale.vestingContract()).to.equal(await vesting.getAddress());
        });

        it("Should set correct treasury", async function () {
            expect(await sale.treasury()).to.equal(treasury.address);
        });

        it("Should set correct token price", async function () {
            expect(await sale.tokenPrice()).to.equal(TOKEN_PRICE);
        });

        it("Should set correct sale cap", async function () {
            expect(await sale.saleCap()).to.equal(SALE_CAP);
        });

        it("Should set correct min purchase", async function () {
            expect(await sale.minPurchase()).to.equal(MIN_PURCHASE);
        });

        it("Should set correct wallet cap", async function () {
            expect(await sale.walletCap()).to.equal(WALLET_CAP);
        });

        it("Should set correct sale times", async function () {
            expect(await sale.saleStart()).to.be.gt(0);
            expect(await sale.saleEnd()).to.be.gt(await sale.saleStart());
        });

        it("Should have active state after start", async function () {
            expect(await sale.getSaleState()).to.equal(1); // Active = 1
        });

        it("Should set governance role correctly", async function () {
            const GOVERNANCE_ROLE = await sale.GOVERNANCE_ROLE();
            expect(await sale.hasRole(GOVERNANCE_ROLE, governance.address)).to.be.true;
        });

        it("Should support ETH by default", async function () {
            const ethInfo = await sale.getCurrencyInfo(ethers.ZeroAddress);
            expect(ethInfo.supported).to.be.true;
            expect(ethInfo.decimals_).to.equal(18);
            expect(ethInfo.price).to.equal(TOKEN_PRICE);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // PURCHASE TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Purchases", function () {
        it("Should allow ETH purchase", async function () {
            const ethAmount = ethers.parseEther("1");
            
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            const vestingSchedule = await vesting.vestingSchedules(buyer1.address);
            expect(vestingSchedule.totalAllocation).to.be.gt(0);
        });

        it("Should forward ETH to treasury", async function () {
            const ethAmount = ethers.parseEther("1");
            const beforeBalance = await ethers.provider.getBalance(treasury.address);
            
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            const afterBalance = await ethers.provider.getBalance(treasury.address);
            expect(afterBalance - beforeBalance).to.equal(ethAmount);
        });

        it("Should track total purchased per user", async function () {
            const ethAmount = ethers.parseEther("1");
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            const purchased = await sale.totalPurchased(buyer1.address);
            expect(purchased).to.be.gt(0);
        });

        it("Should track total sold", async function () {
            const ethAmount = ethers.parseEther("1");
            const beforeSold = await sale.totalSold();
            
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            const afterSold = await sale.totalSold();
            expect(afterSold).to.be.gt(beforeSold);
        });

        it("Should track total buyers", async function () {
            const ethAmount = ethers.parseEther("1");
            const beforeBuyers = await sale.totalBuyers();
            
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            const afterBuyers = await sale.totalBuyers();
            expect(afterBuyers).to.equal(beforeBuyers + 1n);
        });

        it("Should enforce wallet cap", async function () {
            const ethNeeded = (WALLET_CAP * BigInt(TOKEN_PRICE) * 10n**18n) / (1000000n * 10n**18n);
            
            await sale.connect(buyer1).purchaseWithEth({ value: ethNeeded + ethers.parseEther("1") });
            
            const purchased = await sale.totalPurchased(buyer1.address);
            expect(purchased).to.be.lte(WALLET_CAP);
        });

        it("Should enforce minimum purchase", async function () {
            const smallAmount = ethers.parseEther("0.000001");
            
            await expect(
                sale.connect(buyer1).purchaseWithEth({ value: smallAmount })
            ).to.be.revertedWithCustomError(sale, "Sale__BelowMinPurchase");
        });

        it("Should enforce sale cap", async function () {
            const ethNeeded = (SALE_CAP * BigInt(TOKEN_PRICE) * 10n**18n) / (1000000n * 10n**18n);
            await sale.connect(buyer1).purchaseWithEth({ value: ethNeeded });
            
            await expect(
                sale.connect(buyer2).purchaseWithEth({ value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(sale, "Sale__ExceedsSaleCap");
        });

        it("Should enforce cooldown between purchases", async function () {
            const ethAmount = ethers.parseEther("1");
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            await expect(
                sale.connect(buyer1).purchaseWithEth({ value: ethAmount })
            ).to.be.revertedWithCustomError(sale, "Sale__CooldownNotElapsed");
        });

        it("Should allow purchase after cooldown", async function () {
            const ethAmount = ethers.parseEther("1");
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            await time.increase(61);
            
            await expect(
                sale.connect(buyer1).purchaseWithEth({ value: ethAmount })
            ).to.not.be.reverted;
        });

        it("Should block purchases when paused", async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(14, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            await expect(
                sale.connect(buyer1).purchaseWithEth({ value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(sale, "EnforcedPause");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // CURRENCY MANAGEMENT TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Currency Management", function () {
        it("Should allow adding new currency via timelock", async function () {
            const MockTokenFactory = await ethers.getContractFactory("Token");
            const mockToken = await MockTokenFactory.deploy(
                "Mock", "MCK", governance.address, treasury.address,
                ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
                1000000, 0, 0, 0
            );
            await mockToken.waitForDeployment();
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "uint8"],
                [await mockToken.getAddress(), 2000000, 18]
            );
            
            const tx = await sale.connect(governance).proposeAction(7, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            const currencyInfo = await sale.getCurrencyInfo(await mockToken.getAddress());
            expect(currencyInfo.supported).to.be.true;
            expect(currencyInfo.price).to.equal(2000000);
        });

        it("Should allow removing currency via timelock", async function () {
            const MockTokenFactory = await ethers.getContractFactory("Token");
            const mockToken = await MockTokenFactory.deploy(
                "Mock", "MCK", governance.address, treasury.address,
                ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
                1000000, 0, 0, 0
            );
            await mockToken.waitForDeployment();
            
            let data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "uint8"],
                [await mockToken.getAddress(), 2000000, 18]
            );
            let tx = await sale.connect(governance).proposeAction(7, data);
            let receipt = await tx.wait();
            let event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            let actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address"],
                [await mockToken.getAddress()]
            );
            tx = await sale.connect(governance).proposeAction(8, data);
            receipt = await tx.wait();
            event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            actionId = event?.args?.[0];
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            const currencyInfo = await sale.getCurrencyInfo(await mockToken.getAddress());
            expect(currencyInfo.supported).to.be.false;
        });

        it("Should not allow duplicate currency", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "uint8"],
                [ethers.ZeroAddress, 1000000, 18]
            );
            
            await expect(
                sale.connect(governance).proposeAction(7, data)
            ).to.be.revertedWithCustomError(sale, "Sale__CurrencyAlreadySupported");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // SALE STATE MANAGEMENT TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Sale State Management", function () {
        it("Should allow ending sale via timelock", async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(1, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            expect(await sale.getSaleState()).to.equal(2); // Ended = 2
        });

        it("Should block purchases after sale ends", async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(1, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            await expect(
                sale.connect(buyer1).purchaseWithEth({ value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(sale, "Sale__SaleNotActive");
        });

        it("Should allow updating price via timelock", async function () {
            const newPrice = 2000000;
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256"],
                [newPrice]
            );
            
            const tx = await sale.connect(governance).proposeAction(2, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            expect(await sale.tokenPrice()).to.equal(newPrice);
        });

        it("Should allow updating caps via timelock", async function () {
            const newWalletCap = ethers.parseUnits("5000000", 18);
            const newSaleCap = ethers.parseUnits("100000000", 18);
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [newWalletCap, newSaleCap]
            );
            
            const tx = await sale.connect(governance).proposeAction(4, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            expect(await sale.walletCap()).to.equal(newWalletCap);
            expect(await sale.saleCap()).to.equal(newSaleCap);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE & TIMELOCK TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance & Timelock", function () {
        it("Should allow governance to propose and execute", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256"],
                [2000000]
            );
            
            const tx = await sale.connect(governance).proposeAction(2, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            expect(await sale.tokenPrice()).to.equal(2000000);
        });

        it("Should not allow execution before timelock delay", async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(1, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await expect(
                sale.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(sale, "Sale__TimelockNotElapsed");
        });

        it("Should not allow non-governance to propose", async function () {
            await expect(
                sale.connect(buyer1).proposeAction(0, "0x")
            ).to.be.revertedWithCustomError(sale, "Sale__NotGovernance");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Governance Finalization", function () {
        it("Should not allow finalization before 180 days", async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(11, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            await expect(
                sale.connect(governance).executeAction(actionId)
            ).to.be.revertedWithCustomError(sale, "Sale__LockPeriodNotElapsed");
        });

        it("Should allow finalization after 180 days", async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(11, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
            
            expect(await sale.governanceFinalized()).to.be.true;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // POST-FINALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("Post-Finalization", function () {
        beforeEach(async function () {
            const data = "0x";
            const tx = await sale.connect(governance).proposeAction(11, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(GOVERNANCE_LOCK_PERIOD + TIMELOCK_DELAY + 1n);
            await sale.connect(governance).executeAction(actionId);
        });

        it("Should block price updates after finalization", async function () {
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256"],
                [2000000]
            );
            
            await expect(
                sale.connect(governance).proposeAction(2, data)
            ).to.be.revertedWithCustomError(sale, "Sale__FunctionLockedAfter180Days");
        });

        it("Should allow rescue tokens after finalization", async function () {
            await token.connect(treasury).transfer(await sale.getAddress(), ethers.parseUnits("1000", 18));
            
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint256"],
                [await token.getAddress(), treasury.address, ethers.parseUnits("1000", 18)]
            );
            
            const tx = await sale.connect(governance).proposeAction(12, data);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "ActionProposed");
            const actionId = event?.args?.[0];
            
            await time.increase(TIMELOCK_DELAY + 1n);
            
            const beforeBalance = await token.balanceOf(treasury.address);
            await sale.connect(governance).executeAction(actionId);
            const afterBalance = await token.balanceOf(treasury.address);
            
            expect(afterBalance).to.be.gt(beforeBalance);
        });

        it("Should block role management after finalization", async function () {
            const GOVERNANCE_ROLE = await sale.GOVERNANCE_ROLE();
            
            await expect(
                sale.connect(governance).grantRole(GOVERNANCE_ROLE, buyer1.address)
            ).to.be.revertedWithCustomError(sale, "Sale__RoleManagementLocked");
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS TESTS
    // ═══════════════════════════════════════════════════════════════
    
    describe("View Functions", function () {
        it("Should return correct sale state", async function () {
            const state = await sale.getSaleState();
            expect(state).to.equal(1); // Active
        });

        it("Should preview token amount correctly", async function () {
            const ethAmount = ethers.parseEther("1");
            const preview = await sale.previewTokenAmount(ethers.ZeroAddress, ethAmount);
            
            const expected = (ethAmount * 1000000n * 10n**18n) / (BigInt(TOKEN_PRICE) * 10n**18n);
            expect(preview).to.equal(expected);
        });

        it("Should return remaining sale cap", async function () {
            const remaining = await sale.remainingSaleCap();
            expect(remaining).to.equal(SALE_CAP);
        });

        it("Should return remaining wallet cap", async function () {
            const remaining = await sale.remainingWalletCap(buyer1.address);
            expect(remaining).to.equal(WALLET_CAP);
        });

        it("Should check if currency is supported", async function () {
            expect(await sale.isCurrencySupported(ethers.ZeroAddress)).to.be.true;
            expect(await sale.isCurrencySupported(buyer1.address)).to.be.false;
        });

        it("Should return supported currencies list", async function () {
            const currencies = await sale.getSupportedCurrencies();
            expect(currencies.length).to.be.gte(1);
            expect(currencies[0]).to.equal(ethers.ZeroAddress);
        });

        it("Should return correct time until start", async function () {
            const timeUntil = await sale.timeUntilStart();
            expect(timeUntil).to.equal(0); // Already started
        });

        it("Should return correct time until end", async function () {
            const timeUntil = await sale.timeUntilEnd();
            expect(timeUntil).to.be.gt(0);
        });

        it("Should check canPurchase correctly", async function () {
            const canPurchase = await sale.canPurchase(buyer1.address, MIN_PURCHASE);
            expect(canPurchase).to.be.true;
        });

        it("Should return correct purchase info", async function () {
            const ethAmount = ethers.parseEther("1");
            await sale.connect(buyer1).purchaseWithEth({ value: ethAmount });
            
            const info = await sale.getPurchaseInfo(buyer1.address);
            expect(info.purchased).to.be.gt(0);
            expect(info.remainingCap).to.be.lt(WALLET_CAP);
            expect(info.lastPurchase).to.be.gt(0);
        });

        it("Should check can finalize governance", async function () {
            const canFinalize = await sale.canFinalizeGovernance();
            expect(canFinalize).to.be.false;
        });

        it("Should return time until finalization", async function () {
            const timeUntil = await sale.timeUntilFinalization();
            expect(timeUntil).to.be.gt(0);
        });

        it("Should check governance lock status", async function () {
            const isLocked = await sale.isGovernanceLocked();
            expect(isLocked).to.be.false;
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════
    
    describe("Edge Cases", function () {
        it("Should handle zero ETH purchase", async function () {
            await expect(
                sale.connect(buyer1).purchaseWithEth({ value: 0 })
            ).to.be.revertedWithCustomError(sale, "Sale__InvalidAmount");
        });

        it("Should track hasPurchased correctly", async function () {
            expect(await sale.hasPurchased(buyer1.address)).to.be.false;
            
            await sale.connect(buyer1).purchaseWithEth({ value: ethers.parseEther("1") });
            
            expect(await sale.hasPurchased(buyer1.address)).to.be.true;
        });

        it("Should handle multiple buyers", async function () {
            await sale.connect(buyer1).purchaseWithEth({ value: ethers.parseEther("1") });
            await sale.connect(buyer2).purchaseWithEth({ value: ethers.parseEther("2") });
            await sale.connect(buyer3).purchaseWithEth({ value: ethers.parseEther("0.5") });
            
            expect(await sale.totalBuyers()).to.equal(3);
            expect(await sale.totalSold()).to.be.gt(0);
        });

        it("Should update last purchase time correctly", async function () {
            const beforeTime = await time.latest();
            await sale.connect(buyer1).purchaseWithEth({ value: ethers.parseEther("1") });
            const afterTime = await time.latest();
            
            const lastPurchase = await sale.lastPurchaseTime(buyer1.address);
            expect(lastPurchase).to.be.gte(beforeTime);
            expect(lastPurchase).to.be.lte(afterTime);
        });
    });
});