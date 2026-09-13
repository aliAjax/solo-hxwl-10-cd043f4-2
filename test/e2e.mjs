// 真实浏览器验证：窄屏无横向滚动、筛选/关系图/按钮可用，以及阻断→补号、封存→退回→版本→刷新留存
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5110/";
const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
}

const browser = await chromium.launch();
const errors = [];

async function overflowInfo(page, w) {
  return await page.evaluate((w) => {
    const de = document.documentElement;
    const offenders = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > w + 1 || r.left < -1) {
        offenders.push(`${el.tagName}.${(el.className || "").toString().slice(0, 40)} right=${Math.round(r.right)}`);
      }
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, offenders: offenders.slice(0, 8) };
  }, w);
}

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${w}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${w}] ${e.message}`));
  await page.goto(BASE, { waitUntil: "networkidle" });
  return page;
}

// ---------- 1. 窄屏布局：360 / 390 ----------
for (const w of [360, 390]) {
  const page = await newPage(w, 740);
  const info = await overflowInfo(page, w);
  check(`${w}px 无横向滚动`, info.scrollW <= w, `scrollW=${info.scrollW}`);
  check(`${w}px 无元素超出右边距`, info.offenders.length === 0, info.offenders.join(" | "));

  // 筛选条控件都可见且未被截断
  const selects = page.locator(".filter-bar select");
  check(`${w}px 三个筛选下拉都在视口内`, await selects.count() === 3);
  for (let i = 0; i < 3; i++) {
    const box = await selects.nth(i).boundingBox();
    check(`${w}px 筛选#${i}右边缘不超屏`, box && box.x + box.width <= w + 1,
      box ? `right=${Math.round(box.x + box.width)}` : "missing");
  }
  // 关系图（切到 T0203）
  await page.getByRole("button", { name: "T0203", exact: true }).first().click();
  await page.waitForSelector(".strata-svg");
  const svgBox = await page.locator(".strata-svg").first().boundingBox();
  check(`${w}px 关系图缩放后不超宽`, svgBox && svgBox.width <= w + 1,
    svgBox ? `svgW=${Math.round(svgBox.width)}` : "no svg");
  const wrapBox = await page.locator(".graph-wrap").first().boundingBox();
  check(`${w}px 关系图容器完整可见`, wrapBox && wrapBox.x >= 0 && wrapBox.x + wrapBox.width <= w + 1);

  // 操作按钮可见（台账在下方，滚动过去）
  await page.locator(".units-table").first().scrollIntoViewIfNeeded();
  const firstOps = page.locator(".row-ops").first();
  await firstOps.scrollIntoViewIfNeeded();
  const btns = firstOps.locator("button");
  const n = await btns.count();
  let allIn = true;
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    if (!b || b.x < 0 || b.x + b.width > w + 1) allIn = false;
  }
  check(`${w}px 行内 ${n} 个操作按钮全部在屏内可点`, n >= 2 && allIn);
  await page.close();
}

// ---------- 2. 功能流：390px 下完整走一遍 ----------
const page = await newPage(390, 800);
await page.getByRole("radio", { name: "领队" }).click();

// 2a. 新增缺编号记录 → 阻断
await page.getByPlaceholder("如 T0203").fill("T0501");
await page.getByPlaceholder("如 0.8").fill("1.1");
await page.getByRole("button", { name: "登记为草稿" }).click();
await page.waitForTimeout(150);
check("缺编号记录可登记", await page.locator(".units-table .no-code").first().isVisible());
const blockedStat = page.locator(".stat-card", { hasText: "阻断记录" }).locator(".stat-value");
check("阻断统计 +1（G3 与新记录）", (await blockedStat.textContent()) === "2", await blockedStat.textContent());

// 未补齐时推进被拦截
await page.locator(".units-table tr", { hasText: "T0501" }).scrollIntoViewIfNeeded();
const row0 = page.locator(".units-table tr", { hasText: "T0501" });
await row0.getByRole("button", { name: "提交复核" }).click();
await page.waitForTimeout(150);
check("未编号阻断不能提交复核", await page.locator(".toast-err, .conflict-msg", { hasText: "不能提交复核" }).first().isVisible());

// 补齐编号 → 阻断解除
await row0.getByRole("button", { name: "编辑" }).click();
await page.locator(".modal").getByText("遗迹编号").waitFor();
const codeInput = page.locator(".modal input").nth(1);
await codeInput.fill("H77");
await page.getByRole("button", { name: "保存修改" }).click();
await page.waitForTimeout(150);
check("补齐编号后阻断标记消失", !(await page.locator(".units-table tr", { hasText: "H77" }).locator(".blocked-tag").count()));
check("阻断统计回落为 1（仅 G3）", (await blockedStat.textContent()) === "1", await blockedStat.textContent());

// 2b. 提交复核 → 封存 → 退回草稿
const row77 = page.locator(".units-table tr", { hasText: "H77" });
await row77.getByRole("button", { name: "提交复核" }).click();
await page.waitForTimeout(120);
await row77.getByRole("button", { name: "封存" }).click();
await page.waitForTimeout(120);
check("封存后出现退回入口", await row77.getByRole("button", { name: "退回草稿" }).isVisible());

// 非领队不能退回
await page.getByRole("radio", { name: "发掘队员" }).click();
const workerBtn = row77.getByRole("button", { name: "退回草稿" });
check("发掘队员视角退回按钮禁用", (await workerBtn.getAttribute("disabled")) !== null);

// 领队退回
await page.getByRole("radio", { name: "领队" }).click();
await row77.getByRole("button", { name: "退回草稿" }).click();
await page.waitForTimeout(150);
check("退回后状态为草稿", await row77.locator(".st-draft").isVisible());
check("退回后可编辑", await row77.getByRole("button", { name: "编辑" }).isVisible());

// 版本保留封存前版本与退回版本
await row77.getByRole("button", { name: "版本" }).click();
await page.waitForTimeout(100);
const modalText = await page.locator(".modal").innerText();
check("版本历史含封存版本", modalText.includes("封存（待复核 → 已封存）"));
check("版本历史含封存退回版本", modalText.includes("封存退回"));
await page.keyboard.press("Escape");
await page.locator(".modal-x").click().catch(() => {});
await page.waitForTimeout(100);

// 2c. 非法关系：跨探方被拦截并可在图中定位
async function selectByText(select, re) {
  const value = await select.evaluate((el, reSrc) => {
    const rx = new RegExp(reSrc);
    for (const o of el.options) if (rx.test(o.textContent)) return o.value;
    return null;
  }, re.source);
  if (!value) throw new Error("未找到匹配选项: " + re);
  await select.selectOption(value);
}
await page.getByText("只显示同探方").click(); // 取消勾选
const upperSel = page.locator(".rel-form select").first();
await selectByText(upperSel, /T0203 · ①/);
const lowerSel = page.locator(".rel-form select").nth(1);
await selectByText(lowerSel, /T0204 · F2/);
await page.getByRole("button", { name: "建立关系" }).click();
await page.waitForTimeout(150);
check("跨探方关系被拦截", await page.locator(".conflict-msg", { hasText: "跨探方关系被拦截" }).first().isVisible());
const locateBtn = page.locator(".conflict-row", { hasText: "跨探方" }).getByRole("button", { name: "在图中定位" });
check("冲突可定位", await locateBtn.isVisible());
await locateBtn.click();
await page.waitForTimeout(200);
check("定位后图中节点高亮", await page.locator(".node-hi").count() > 0);

// 2d. 刷新后：状态、版本、阻断、关系数不丢
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(200);
const row77b = page.locator(".units-table tr", { hasText: "H77" });
check("刷新后 H77 仍为草稿", await row77b.locator(".st-draft").isVisible());
await row77b.getByRole("button", { name: "版本" }).click();
const modal2 = await page.locator(".modal").innerText();
check("刷新后封存/退回版本仍在", modal2.includes("封存退回") && modal2.includes("已封存"));
await page.locator(".modal-x").click();
check("刷新后阻断统计仍为 1", (await blockedStat.textContent()) === "1", await blockedStat.textContent());
const relStat = page.locator(".stat-card", { hasText: "叠压关系" }).locator(".stat-value");
check("刷新后关系数仍为 4（跨探方未落库）", (await relStat.textContent()) === "4", await relStat.textContent());

// ---------- 3. 宽屏无回归 ----------
const wide = await newPage(1280, 900);
const info = await overflowInfo(wide, 1280);
check("1280px 无横向滚动", info.scrollW <= 1280, `scrollW=${info.scrollW}`);
check("宽屏台账表格完整渲染", await wide.locator(".units-table thead th").count() === 9);
await wide.close();
await page.close();

check("浏览器控制台无错误", errors.length === 0, errors.join(" || "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
