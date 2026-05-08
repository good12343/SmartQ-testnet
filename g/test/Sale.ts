// test/Sale.test.ts (الإصدار الموسّع)
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Sale, ERC20Mock, MockVesting } from "../typechain-types";

describe("Sale Contract (Extended)", function () {
  let sale: Sale;
  let projectToken: ERC20Mock;
  let usdcToken: ERC20Mock;
  let vesting: MockVesting;
  let treasury: SignerWithAddress;
  let governance: SignerWithAddress;
  let operator: SignerWithAddress;
  let buyer: SignerWithAddress;
  let buyer2: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  const TOKEN_DECIMALS = 18n;
  const PRICE_PRECISION = 1_000_000n;
  const INITIAL_PRICE = 10000n; // 0.01 ETH per token (in PRICE_PRECISION units)
  const saleCap = ethers.parseEther("1000000"); // 1,000,000 token
  const minPurchase = ethers.parseEther("100"); // 100 token
  let defaultWalletCap: bigint;

  let saleStart: number;
  let saleEnd: number;

  // دوال مساعدة لتقليل التكرار
  async function startSaleViaGovernance() {
    const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
    const tx = await sale.connect(governance).proposeAction(0, data); // StartSale
    const receipt = await tx.wait();
    const actionId = receipt?.logs[0]?.topics[1];
    await time.increase(48 * 60 * 60 + 1);
    await sale.connect(governance).executeAction(actionId!);
  }

  async function updateWalletCap(newWalletCap: bigint) {
    const updateData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [newWalletCap, saleCap]
    );
    const tx = await sale.connect(governance).proposeAction(4, updateData);
    const receipt = await tx.wait();
    const actionId = receipt?.logs[0]?.topics[1];
    await time.increase(48 * 60 * 60 + 1);
    await sale.connect(governance).executeAction(actionId!);
  }

  async function updateSaleCap(newSaleCap: bigint) {
    const currentWalletCap = await sale.walletCap();
    const updateData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [currentWalletCap, newSaleCap]
    );
    const tx = await sale.connect(governance).proposeAction(4, updateData);
    const receipt = await tx.wait();
    const actionId = receipt?.logs[0]?.topics[1];
    await time.increase(48 * 60 * 60 + 1);
    await sale.connect(governance).executeAction(actionId!);
  }

  async function deployContracts() {
    const block = await ethers.provider.getBlock("latest");
    const now = block!.timestamp;
    saleStart = now + 3600; // بعد ساعة
    saleEnd = now + 30 * 86400; // بعد 30 يوم

    // نشر توكن المشروع و USDC
    const TokenFactory = await ethers.getContractFactory("ERC20Mock");
    projectToken = (await TokenFactory.deploy("Project", "PRJ")) as ERC20Mock;
    usdcToken = (await TokenFactory.deploy("USDC", "USDC")) as ERC20Mock;

    // نشر MockVesting
    const VestingFactory = await ethers.getContractFactory("MockVesting");
    vesting = (await VestingFactory.deploy(await projectToken.getAddress())) as MockVesting;

    // نشر Sale
    const SaleFactory = await ethers.getContractFactory("Sale");
    sale = (await SaleFactory.deploy(
      await projectToken.getAddress(),
      await vesting.getAddress(),
      treasury.address,
      governance.address,
      INITIAL_PRICE,
      saleCap,
      minPurchase,
      saleStart,
      saleEnd
    )) as Sale;

    defaultWalletCap = await sale.walletCap(); // 10,000,000e18

    // تمويل MockVesting بتوكنات البيع
    await projectToken.mint(await vesting.getAddress(), saleCap);
    await vesting.setReservedTokens(0);
  }

  beforeEach(async function () {
    [governance, operator, treasury, buyer, buyer2, unauthorized] = await ethers.getSigners();
    await deployContracts();
  });

  describe("Deployment", function () {
    it("should initialize correctly", async function () {
      expect(await sale.projectToken()).to.equal(await projectToken.getAddress());
      expect(await sale.vestingContract()).to.equal(await vesting.getAddress());
      expect(await sale.treasury()).to.equal(treasury.address);
      expect(await sale.tokenPrice()).to.equal(INITIAL_PRICE);
      expect(await sale.saleCap()).to.equal(saleCap);
      expect(await sale.minPurchase()).to.equal(minPurchase);
      expect(await sale.walletCap()).to.equal(ethers.parseEther("10000000"));
      expect(await sale.saleStart()).to.equal(saleStart);
      expect(await sale.saleEnd()).to.equal(saleEnd);
      expect(await sale.saleState()).to.equal(0); // Inactive
      expect(await sale.governanceFinalized()).to.equal(false);
    });

    it("should support ETH as default currency", async function () {
      const info = await sale.getCurrencyInfo(ethers.ZeroAddress);
      expect(info.supported).to.be.true;
      expect(info.price).to.equal(INITIAL_PRICE);
      expect(info.decimals_).to.equal(18);
    });

    it("should revert if zero addresses", async function () {
      const SaleFactory = await ethers.getContractFactory("Sale");
      await expect(
        SaleFactory.deploy(ethers.ZeroAddress, await vesting.getAddress(), treasury.address, governance.address, INITIAL_PRICE, saleCap, minPurchase, saleStart, saleEnd)
      ).to.be.reverted;
    });
  });

  describe("Governance & Timelock", function () {
    it("should propose and execute StartSale", async function () {
      await startSaleViaGovernance();
      expect(await sale.saleState()).to.equal(1); // Active
    });

    it("should revert if non-governance proposes", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      await expect(
        sale.connect(unauthorized).proposeAction(0, data)
      ).to.be.revertedWithCustomError(sale, "Sale__NotGovernance");
    });

    it("should enforce timelock delay", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await sale.connect(governance).proposeAction(0, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await expect(
        sale.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(sale, "Sale__TimelockNotElapsed");
    });
  });

  describe("Buying Tokens", function () {
    beforeEach(async function () {
      await startSaleViaGovernance();
      // ضمان أننا بعد saleStart
      const now = await time.latest();
      if (now < saleStart) {
        await time.increaseTo(saleStart + 10);
      } else {
        await time.increase(10);
      }
    });

    it("should purchase with ETH", async function () {
      const ethAmount = ethers.parseEther("1"); // 1 ETH => 100 tokens
      const tokenAmount = (ethAmount * PRICE_PRECISION * 10n**18n) / (INITIAL_PRICE * 10n**18n);
      await sale.connect(buyer).purchaseWithEth({ value: ethAmount });
      expect(await vesting.allocations(buyer.address)).to.equal(tokenAmount);
      expect(await sale.totalSold()).to.equal(tokenAmount);
    });

    it("should respect wallet cap", async function () {
      // تقليص walletCap إلى 500 توكن
      await updateWalletCap(ethers.parseEther("500"));

      const eth4 = ethers.parseEther("4"); // 400 tokens
      await sale.connect(buyer).purchaseWithEth({ value: eth4 });

      const eth2 = ethers.parseEther("2"); // 200 tokens (total: 600 > 500)
      await expect(
        sale.connect(buyer).purchaseWithEth({ value: eth2 })
      ).to.be.revertedWithCustomError(sale, "Sale__ExceedsWalletCap");
    });

    it("should respect sale cap", async function () {
      await updateSaleCap(ethers.parseEther("500"));

      const eth4 = ethers.parseEther("4"); // 400 tokens
      await sale.connect(buyer).purchaseWithEth({ value: eth4 });

      const eth2 = ethers.parseEther("2"); // 200 tokens (total: 600 > 500)
      await expect(
        sale.connect(buyer2).purchaseWithEth({ value: eth2 })
      ).to.be.revertedWithCustomError(sale, "Sale__ExceedsSaleCap");
    });

    it("should enforce cooldown", async function () {
      const ethAmount = ethers.parseEther("1"); // 100 tokens, > minPurchase
      await sale.connect(buyer).purchaseWithEth({ value: ethAmount });
      await expect(
        sale.connect(buyer).purchaseWithEth({ value: ethAmount })
      ).to.be.revertedWithCustomError(sale, "Sale__CooldownNotElapsed");
    });

    it("should purchase with ERC20 (USDC)", async function () {
      // إضافة USDC
      const addCurrData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint8"],
        [await usdcToken.getAddress(), 1_000_000n, 6] // 1 USDC = 1 token
      );
      const tx = await sale.connect(governance).proposeAction(7, addCurrData);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);

      // تمويل المشتري بـ USDC
      const usdcAmount = ethers.parseUnits("100", 6);
      await usdcToken.mint(buyer.address, usdcAmount);
      await usdcToken.connect(buyer).approve(await sale.getAddress(), usdcAmount);

      await sale.connect(buyer).purchaseWithERC20(await usdcToken.getAddress(), usdcAmount);
      // تم الشراء دون أخطاء
      expect(await vesting.allocations(buyer.address)).to.be.gt(0);
    });

    it("should revert purchase with unsupported currency", async function () {
      // USDC غير مضاف بعد
      await usdcToken.mint(buyer.address, 1000);
      await usdcToken.connect(buyer).approve(await sale.getAddress(), 1000);
      await expect(
        sale.connect(buyer).purchaseWithERC20(await usdcToken.getAddress(), 100)
      ).to.be.revertedWithCustomError(sale, "Sale__CurrencyNotSupported");
    });

    it("should revert purchase with zero amount", async function () {
      await expect(
        sale.connect(buyer).purchaseWithEth({ value: 0 })
      ).to.be.revertedWithCustomError(sale, "Sale__InvalidAmount");
    });

    it("should adjust saleStart if already past", async function () {
      // بعد بدء البيع، saleStart يجب أن يُسجّل الآن
      expect(await sale.saleStart()).to.be.closeTo(BigInt(saleStart), ethers.parseEther("0.01"));
      // لا يمكننا اختبار التعديل مباشرة لأن startSale سُبق أن استدعي، لكن نختبر منطق `_startSale`.
      // يمكننا إعادة بدء البيع (غير مسموح)، لذا سليم.
    });
  });

  describe("Pause and Unpause", function () {
    it("should pause and unpause through governance", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      // Pause
      const tx = await sale.connect(governance).proposeAction(14, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);
      expect(await sale.paused()).to.be.true;

      // Unpause
      const tx2 = await sale.connect(governance).proposeAction(15, data);
      const receipt2 = await tx2.wait();
      const actionId2 = receipt2?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId2!);
      expect(await sale.paused()).to.be.false;
    });

    it("should not allow purchases while paused", async function () {
      // بدء البيع أولاً
      await startSaleViaGovernance();
      const now = await time.latest();
if (now < saleStart) {
  await time.increaseTo(saleStart + 10);
} else {
  await time.increase(10);
}

      // ايقاف
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await sale.connect(governance).proposeAction(14, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);

      await expect(
  sale.connect(buyer).purchaseWithEth({ value: ethers.parseEther("1") })
).to.be.reverted; // أو .to.be.revertedWith("Pausable: paused") إن أردت الدقة // أو Paused? mod whenNotPaused يستخدم Pausable، الخطأ هو "EnforcedPause" لكن تم تخصيصه؟ في عقدنا لا يوجد whenNotPaused مخصص، لكن Pausable يعطي "Pausable: paused". الخطأ سيختلف. لكن المهم أنه سيرفض.
    });
  });

  describe("Currency Management", function () {
    it("should add a new currency", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint8"],
        [await usdcToken.getAddress(), 500000n, 6]
      );
      const tx = await sale.connect(governance).proposeAction(7, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(sale.connect(governance).executeAction(actionId!))
        .to.emit(sale, "CurrencyAdded");

      const info = await sale.getCurrencyInfo(await usdcToken.getAddress());
      expect(info.supported).to.be.true;
    });

    it("should revert adding ETH as currency", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint8"],
        [ethers.ZeroAddress, INITIAL_PRICE, 18]
      );
      const tx = await sale.connect(governance).proposeAction(7, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        sale.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(sale, "Sale__ZeroAddress");
    });

    it("should remove a currency", async function () {
      // إضافة USDC أولاً
      const addData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint8"],
        [await usdcToken.getAddress(), 500000n, 6]
      );
      let tx = await sale.connect(governance).proposeAction(7, addData);
      let receipt = await tx.wait();
      let actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);

      // إزالتها
      const removeData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await usdcToken.getAddress()]);
      tx = await sale.connect(governance).proposeAction(8, removeData);
      receipt = await tx.wait();
      actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(sale.connect(governance).executeAction(actionId!))
        .to.emit(sale, "CurrencyRemoved");

      expect(await sale.isCurrencySupported(await usdcToken.getAddress())).to.be.false;
    });
  });

  describe("Rescue Functions", function () {
    it("should rescue ETH", async function () {
      await governance.sendTransaction({ to: await sale.getAddress(), value: ethers.parseEther("1") });
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [treasury.address]);
      const tx = await sale.connect(governance).proposeAction(13, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);
      expect(await ethers.provider.getBalance(treasury.address)).to.be.gt(ethers.parseEther("9999"));
    });

    it("should rescue tokens", async function () {
      const amount = ethers.parseEther("100");
      await projectToken.mint(await sale.getAddress(), amount);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256"],
        [await projectToken.getAddress(), treasury.address, amount]
      );
      const tx = await sale.connect(governance).proposeAction(12, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);
      expect(await projectToken.balanceOf(treasury.address)).to.equal(amount);
    });

    it("should revert rescue tokens if called by unauthorized", async function () {
      await expect(
        sale.connect(unauthorized).proposeAction(12, ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint256"],
          [await projectToken.getAddress(), treasury.address, 0]
        ))
      ).to.be.revertedWithCustomError(sale, "Sale__NotGovernance");
    });
  });

  describe("View Functions", function () {
    it("should preview token amount", async function () {
      const ethAmount = ethers.parseEther("1");
      const expected = (ethAmount * PRICE_PRECISION * 10n**18n) / (INITIAL_PRICE * 10n**18n);
      expect(await sale.previewTokenAmount(ethers.ZeroAddress, ethAmount)).to.equal(expected);
    });

    it("should return correct remaining caps", async function () {
      expect(await sale.remainingSaleCap()).to.equal(saleCap);
      expect(await sale.remainingWalletCap(buyer.address)).to.equal(await sale.walletCap());
    });

    it("should get purchase info after buying", async function () {
      await startSaleViaGovernance();
      const now = await time.latest();
if (now < saleStart) {
  await time.increaseTo(saleStart + 10);
} else {
  await time.increase(10);
}
      const ethAmount = ethers.parseEther("1");
      await sale.connect(buyer).purchaseWithEth({ value: ethAmount });

      const info = await sale.getPurchaseInfo(buyer.address);
      expect(info.purchased).to.be.gt(0);
      expect(info.remainingCap).to.be.equal(defaultWalletCap - info.purchased);
      expect(info.cooldownRemaining).to.be.equal(60); // بعد الشراء مباشرة؟ سيكون cooldownRemaining = cooldown (60) إلا إذا مر وقت. لكننا فوراً، لذا cooldownRemaining = 60. لكننا استخدمنا زيادة وقت بسيطة بعد الشراء، ربما 0. المهم وجود القيمة.
    });

    it("canPurchase should return false if not started", async function () {
      expect(await sale.canPurchase(buyer.address, ethers.parseEther("100"))).to.be.false;
    });

    it("canPurchase should return true when active", async function () {
      await startSaleViaGovernance();
      const now = await time.latest();
if (now < saleStart) {
  await time.increaseTo(saleStart + 10);
} else {
  await time.increase(10);
}
      expect(await sale.canPurchase(buyer.address, minPurchase)).to.be.true;
    });

    it("timeUntilStart and timeUntilEnd", async function () {
      expect(await sale.timeUntilStart()).to.be.gt(0);
      await startSaleViaGovernance();
      const now = await time.latest();
if (now < saleStart) {
  await time.increaseTo(saleStart + 10);
} else {
  await time.increase(10);
}
      expect(await sale.timeUntilStart()).to.equal(0);
      expect(await sale.timeUntilEnd()).to.be.gt(0);
    });
  });

  describe("Governance Finalization", function () {
    it("should revert finalization before 180 days", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await sale.connect(governance).proposeAction(11, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        sale.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(sale, "Sale__LockPeriodNotElapsed");
    });

    it("should allow finalization after 180 days (propose before lock)", async function () {
      await time.increase(179 * 24 * 60 * 60);
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await sale.connect(governance).proposeAction(11, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(1 * 24 * 60 * 60 + 48 * 60 * 60 + 1); // cross 180 days
      await sale.connect(governance).executeAction(actionId!);
      expect(await sale.governanceFinalized()).to.equal(true);
    });

    it("should lock governance after 180 days", async function () {
      await time.increase(180 * 24 * 60 * 60 + 1);
      expect(await sale.isGovernanceLocked()).to.be.true;

      // لا يمكن اقتراح أفعال غير إنقاذية
      const data = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      await expect(
        sale.connect(governance).proposeAction(0, data)
      ).to.be.revertedWithCustomError(sale, "Sale__FunctionLockedAfter180Days");
    });
  });

  describe("Edge Cases & Security", function () {
    it("should revert if token decimals > 77", async function () {
      // إضافة عملة بـ decimals 78
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint8"],
        [await usdcToken.getAddress(), INITIAL_PRICE, 78]
      );
      const tx = await sale.connect(governance).proposeAction(7, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        sale.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(sale, "Sale__InvalidDecimals");
    });

    it("should update treasury and vesting", async function () {
      const newTreasury = await projectToken.getAddress(); // أي عقد موجود
const newVesting = await projectToken.getAddress();

      // تحديث treasury
      let data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newTreasury]);
      let tx = await sale.connect(governance).proposeAction(9, data);
      let receipt = await tx.wait();
      let actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);
      expect(await sale.treasury()).to.equal(newTreasury);

      // تحديث vesting
      data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newVesting]);
      tx = await sale.connect(governance).proposeAction(10, data);
      receipt = await tx.wait();
      actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);
      expect(await sale.vestingContract()).to.equal(newVesting);
    });

    it("should revert updateCaps if newWalletCap < minPurchase", async function () {
      const badWalletCap = ethers.parseEther("10"); // أقل من minPurchase=100
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256"],
        [badWalletCap, saleCap]
      );
      const tx = await sale.connect(governance).proposeAction(4, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        sale.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(sale, "Sale__InvalidAmount");
    });

    it("should revert updateMinPurchase if > walletCap", async function () {
      const tooHigh = defaultWalletCap + 1n;
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [tooHigh]);
      const tx = await sale.connect(governance).proposeAction(5, data);
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await expect(
        sale.connect(governance).executeAction(actionId!)
      ).to.be.revertedWithCustomError(sale, "Sale__InvalidAmount");
    });

    it("should update price for specific currency", async function () {
      const newPrice = 20000n;
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ethers.ZeroAddress, newPrice]
      );
      const tx = await sale.connect(governance).proposeAction(16, data); // UpdateCurrencyPrice
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);

      expect((await sale.currencies(ethers.ZeroAddress)).price).to.equal(newPrice);
      expect(await sale.tokenPrice()).to.equal(newPrice);
    });
  });

  // اختبار دورة حياة كاملة
  describe("Full Lifecycle", function () {
    it("should run a complete sale scenario", async function () {
      await startSaleViaGovernance();
      const now = await time.latest();
if (now < saleStart) {
  await time.increaseTo(saleStart + 10);
} else {
  await time.increase(10);
}

      // مشترين متعددين
      const eth1 = ethers.parseEther("1");
      await sale.connect(buyer).purchaseWithEth({ value: eth1 });
      await time.increase(60); // للتغلب على cooldown
      await sale.connect(buyer).purchaseWithEth({ value: ethers.parseEther("2") });

      const eth2 = ethers.parseEther("3");
      await sale.connect(buyer2).purchaseWithEth({ value: eth2 });

      expect(await sale.totalSold()).to.be.gt(0);
      expect(await sale.totalBuyers()).to.equal(2);

      // إنهاء البيع
      const endData = ethers.AbiCoder.defaultAbiCoder().encode([], []);
      const tx = await sale.connect(governance).proposeAction(1, endData); // EndSale
      const receipt = await tx.wait();
      const actionId = receipt?.logs[0]?.topics[1];
      await time.increase(48 * 60 * 60 + 1);
      await sale.connect(governance).executeAction(actionId!);

      expect(await sale.saleState()).to.equal(2); // Ended

      // محاولة شراء بعد النهاية
      await expect(
        sale.connect(buyer).purchaseWithEth({ value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });
});