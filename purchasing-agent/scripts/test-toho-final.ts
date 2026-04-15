/**
 * 購入者情報→決済画面到達テスト（成功フロー確認済み、最終ステップ）
 */
import dotenv from "dotenv";
dotenv.config();
process.env.HEADLESS = "false";

import { newPage, humanDelay, closeBrowser } from "../src/lib/browser.js";
import { writeFileSync } from "node:fs";

async function ss(page: any, name: string) {
  await page.screenshot({ path: `scripts/toho-${name}.png` });
  console.log(`  📸 ${name}`);
}

async function main() {
  console.log("=== 決済画面到達 最終テスト ===\n");
  const page = await newPage();
  page.setDefaultTimeout(20000);

  try {
    // === 1-3. スケジュール → ゲスト購入 ===
    console.log("1-3. スケジュール→ゲスト購入...");
    await page.goto("https://hlo.tohotheater.jp/net/schedule/084/TNPI2000J01.do", { waitUntil: "domcontentloaded" });
    await humanDelay(6000, 8000);
    const jsCode = await page.evaluate(() => {
      const a = document.querySelector('a[href*="purchaseTicket"]') as HTMLAnchorElement;
      return a?.href?.replace("javascript:", "") || "";
    });
    if (!jsCode) { console.log("❌"); return; }
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
      page.evaluate((c: string) => eval(c), jsCode),
    ]);
    await humanDelay(2000, 3000);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
      page.click('button[type="submit"]'),
    ]);
    await humanDelay(3000, 5000);

    // === 4. 空席選択 ===
    console.log("4. 空席選択...");
    const seat = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[onclick*="seatSelect"]'));
      const available = imgs.filter(img => img.getAttribute("alt")?.includes("空席"));
      // 中央付近
      const rows = [...new Set(available.map(i => i.id.split("-")[0]))].sort();
      const midRow = rows[Math.floor(rows.length / 2)];
      const rowImgs = available.filter(i => i.id.startsWith(midRow + "-"));
      const sel = rowImgs[Math.floor(rowImgs.length / 2)] || available[0];
      if (sel) {
        sel.scrollIntoView({ block: "center" });
        return { id: sel.id };
      }
      return null;
    });
    if (!seat) { console.log("❌ 空席なし"); return; }
    await humanDelay(500, 1000);
    const pos = await page.evaluate((id: string) => {
      const r = document.getElementById(id)!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, seat.id);
    await page.mouse.click(pos.x, pos.y);
    await humanDelay(2000, 3000);
    const sn = await page.evaluate(() => (document.querySelector('input[name="seat_no"]') as any)?.value || "");
    console.log(`  座席: ${seat.id} → seat_no="${sn}"`);
    if (!sn) { console.log("❌ seat_no 未セット"); return; }

    // === 5. bookSeat() → チケットの種類 ===
    console.log("5. bookSeat()...");
    await page.evaluate(() => {
      document.getElementById("confirm")?.classList.remove("disabled");
      (window as any).bookSeat();
    });
    await page.waitForNavigation({ waitUntil: "load", timeout: 20000 }).catch(() => null);
    await humanDelay(2000, 3000);
    console.log(`  → ${await page.title()}`);

    // === 6. 券種選択 (SelectTicket.setTicket) ===
    console.log("6. 券種選択...");
    const ticketClicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="SelectTicket.setTicket"]'));
      if (links.length > 0) { (links[0] as HTMLAnchorElement).click(); return links[0].textContent?.trim(); }
      return null;
    });
    console.log(`  ${ticketClicked}`);
    await humanDelay(2000, 3000);

    // === 7. gotoRej → 購入者情報 ===
    console.log("7. gotoRej(4)...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }).catch(() => null),
      page.evaluate(() => (window as any).gotoRej(4, "084", "", "")),
    ]);
    await humanDelay(3000, 5000);
    console.log(`  → ${await page.title()} (${page.url().split("/").pop()})`);
    await ss(page, "7-purchase-info");

    // === 8. 購入者情報HTMLダンプ + フィールド入力 ===
    console.log("\n8. 購入者情報フィールド調査...");
    const html = await page.content();
    writeFileSync("scripts/toho-purchase-info.html", html);

    // 全入力フィールド
    const fields = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input:not([type='hidden']), select, textarea"))
        .filter(el => el.getBoundingClientRect().width > 0)
        .map(el => ({
          tag: el.tagName,
          type: el.getAttribute("type") || "",
          name: (el as HTMLInputElement).name,
          id: el.id,
          placeholder: el.getAttribute("placeholder") || "",
          maxlength: el.getAttribute("maxlength") || "",
          required: el.hasAttribute("required"),
        }))
    );
    console.log("  フィールド:");
    fields.forEach((f: any) => console.log(`    ${f.name} (${f.type}) id=${f.id} max=${f.maxlength} placeholder="${f.placeholder}"`));

    // フィールド入力 (フィールド名が判明: sur_name, first_name, etc.)
    console.log("\n  → ダミー値入力...");
    await page.fill('#sur_name', '映画');
    await page.fill('#first_name', '太郎');
    await page.fill('#sur_name_kana', 'エイガ');
    await page.fill('#first_name_kana', 'タロウ');
    await page.fill('#tel', '09012345678');
    await page.fill('#mail1', 'test@example.com');
    await page.fill('#mail-02', 'test@example.com');
    console.log("    テキストフィールド入力完了");

    // 性別ラジオ（最初の選択肢）
    const sexRadio = await page.$('input[name="sex"]');
    if (sexRadio) { await sexRadio.click({ force: true }); console.log("    性別選択"); }

    // 年代セレクト
    const ageSelect = await page.$('select[name="age"]');
    if (ageSelect) {
      await ageSelect.selectOption({ index: 3 }); // 適当な年代
      console.log("    年代選択");
    }

    // 決済方法ラジオボタンの選択肢を表示
    const paymentOptions = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[name="payment-01"]')).map((r, i) => {
        const label = r.closest("label")?.textContent?.trim() ||
                     r.parentElement?.textContent?.trim() ||
                     document.querySelector(`label[for="${r.id}"]`)?.textContent?.trim() || "";
        return {
          index: i,
          value: (r as HTMLInputElement).value,
          label: label.replace(/\s+/g, " ").slice(0, 60),
          id: r.id,
        };
      });
    });
    console.log("\n  === 決済方法ラジオボタン ===");
    paymentOptions.forEach((p: any) => console.log(`    [${p.index}] value="${p.value}" "${p.label}"`));

    // クレジットカードを選択（最初の選択肢がクレカのはず）
    const creditRadio = await page.$('input[name="payment-01"]');
    if (creditRadio) {
      await creditRadio.click({ force: true });
      console.log("    → クレジットカード選択");
    }

    await humanDelay(1000, 2000);
    await ss(page, "8-after-fill");

    // 次へボタン
    console.log("\n  → 次へ...");
    const nextBtn = await page.$('a:has-text("次へ")') || await page.$('input[type="submit"]') || await page.$('button[type="submit"]');
    if (nextBtn) {
      await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load", timeout: 20000 }).catch(() => null),
        nextBtn.click({ force: true }),
      ]);
      await humanDelay(3000, 5000);
    }

    let currentTitle = await page.title();
    let currentUrl = page.url();
    console.log(`  → ${currentTitle} (${currentUrl.split("/").pop()})`);
    await ss(page, "9-after-next");

    // まだ同じページ（バリデーションエラー）の場合
    if (currentUrl.includes("TNPI2030")) {
      console.log("\n  ⚠️ まだ購入者情報ページ。エラーチェック...");
      const errors = await page.evaluate(() => {
        const errs: string[] = [];
        document.querySelectorAll('[class*="error"], .is-error, [class*="err-msg"]').forEach(el => {
          const t = el.textContent?.trim();
          if (t && t.length < 200) errs.push(t);
        });
        // 空のrequiredフィールド
        document.querySelectorAll("input:not([type='hidden'])").forEach(el => {
          const inp = el as HTMLInputElement;
          if (inp.getBoundingClientRect().width > 0 && !inp.value && inp.name) {
            errs.push(`空: ${inp.name} (${inp.type})`);
          }
        });
        return errs;
      });
      errors.forEach(e => console.log(`    ${e}`));

      // HTMLダンプ
      writeFileSync("scripts/toho-purchase-error.html", await page.content());
    }

    // === 決済画面到達ループ ===
    for (let i = 0; i < 5; i++) {
      currentUrl = page.url();
      currentTitle = await page.title();
      const body = (await page.textContent("body")) || "";
      console.log(`\n--- Step ${i} ---`);
      console.log(`  ${currentTitle} (${currentUrl.split("/").pop()})`);

      if (currentUrl.includes("TNPI2060") || currentUrl.includes("TNPI2070") ||
          currentTitle.includes("支払") || body.includes("クレジットカード番号") ||
          body.includes("お支払い方法を選択")) {
        console.log("\n🎉🎉🎉 決済画面到達！！！ 🎉🎉🎉");
        writeFileSync("scripts/toho-payment-page.html", await page.content());
        await ss(page, "PAYMENT");

        // 決済方法を全取得
        const payInfo = await page.evaluate(() => {
          const body = document.body.textContent || "";
          return {
            hasCredit: body.includes("クレジット"),
            hasVisa: body.includes("VISA"),
            hasMaster: body.includes("Mastercard") || body.includes("マスターカード"),
            hasJCB: body.includes("JCB"),
            hasAmex: body.includes("American Express") || body.includes("AMEX"),
            hasDiners: body.includes("Diners"),
            hasAuPay: body.includes("au PAY"),
            hasDbarai: body.includes("d払い"),
            hasRakuten: body.includes("楽天"),
            hasSoftbank: body.includes("ソフトバンク"),
            hasApplePay: body.includes("Apple Pay"),
            hasGiftCard: body.includes("ギフトカード"),
            hasPayPay: body.includes("PayPay"),
          };
        });
        console.log("\n=== 決済方法 ===");
        Object.entries(payInfo).forEach(([k, v]) => {
          if (v) console.log(`  ✅ ${k.replace("has", "")}`);
        });
        break;
      }

      if (currentUrl.includes("TNPI2000")) { console.log("❌ スケジュールに戻った"); break; }

      const next = await page.$('a:has-text("次へ")') || await page.$('input[type="submit"]');
      if (next) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load", timeout: 20000 }).catch(() => null),
          next.click({ force: true }),
        ]);
        await humanDelay(2000, 3000);
      } else { break; }
    }

    console.log("\n⏳ 60秒ブラウザ表示...");
    await new Promise(r => setTimeout(r, 60000));
  } catch (e) {
    console.error("❌", e);
    try { await ss(page, "error"); } catch {}
    await new Promise(r => setTimeout(r, 30000));
  } finally {
    await closeBrowser();
    console.log("=== 完了 ===");
  }
}

main().catch(console.error);
