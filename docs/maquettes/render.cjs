const { chromium } = require("playwright");
const path = require("path");
const DESK = ["accueil", "civ", "assistant1", "assistant3", "reglages", "apropos"];
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const v of process.argv.slice(2)) {
    const desk = DESK.includes(v);
    const page = await browser.newPage({ viewport: desk ? { width: 1200, height: 800 } : { width: 1920, height: 1080 } });
    page.on("pageerror", (e) => errors.push(v + ": " + e.message));
    page.on("requestfailed", (r) => errors.push(v + " failed " + r.url()));
    await page.goto(`file://${path.join(__dirname, "audit.html")}?v=${v}`);
    await page.waitForTimeout(500);
    const clip = desk ? undefined : { x: 40, y: 0, width: 1740, height: v === "windows" ? 560 : v === "jeu" ? 400 : v === "erreurs" ? 540 : 420 };
    await page.screenshot({ path: path.join(__dirname, `bogo-${v}.png`), clip });
    await page.close();
  }
  console.log("errors:", errors);
  await browser.close();
})();
