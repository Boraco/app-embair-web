export default async function run(page, ui) {
  await page.setViewportSize({ width: 420, height: 900 })
  await page.waitForSelector("#prod-grid > div", { timeout: 15000 })
  await page.waitForTimeout(1500)

  // Recorte de la zona de la grilla (primeras tarjetas con marca/empaque)
  const box = await page.evaluate(() => {
    const g = document.getElementById("prod-grid")
    const r = g.getBoundingClientRect()
    return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y) + window.scrollY), width: Math.min(420, Math.round(r.width)), height: 420 }
  })
  await page.screenshot({ path: "_qa_cards.png", clip: { x: 0, y: box.y - 0, width: 420, height: 420 }, fullPage: true }).catch(() => { })

  return { box }
}
