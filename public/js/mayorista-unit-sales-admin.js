(() => {
  const productsSection = document.getElementById("products")?.closest("section")
  const productList = document.getElementById("products")
  if (!productsSection || !productList) return

  const panel = document.createElement("section")
  panel.className = "mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4"
  panel.innerHTML = `
    <div class="mb-3">
      <h3 class="font-bold text-sky-950">Venta puntual por unidad</h3>
      <p class="mt-1 text-sm text-sky-900">Configura el precio mayorista de una unidad de inventario. Si queda vacío, ese producto solo podrá solicitarse por empaque.</p>
    </div>
    <div data-unit-price-status class="mb-2 hidden rounded border px-3 py-2 text-sm" role="status"></div>
    <div class="overflow-x-auto">
      <table class="w-full min-w-[560px] text-left text-sm">
        <thead><tr class="border-b border-sky-200 text-xs uppercase text-sky-800"><th class="py-2">Producto</th><th>Unidades por empaque</th><th>Precio unitario (USD)</th></tr></thead>
        <tbody data-unit-price-rows></tbody>
      </table>
    </div>
    <button type="button" data-save-unit-prices class="mt-3 rounded-lg bg-sky-800 px-4 py-2 text-sm font-bold text-white">Guardar precios unitarios</button>`
  productsSection.insertBefore(panel, productList)

  const rowsTarget = panel.querySelector("[data-unit-price-rows]")
  const statusTarget = panel.querySelector("[data-unit-price-status]")
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character])

  function showStatus(message, failed = false) {
    statusTarget.textContent = message
    statusTarget.className = `mb-2 rounded border px-3 py-2 text-sm ${failed ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`
    statusTarget.classList.remove("hidden")
  }

  function getToken() {
    try { return localStorage.getItem("admin_token") || "" } catch { return "" }
  }

  async function fetchAdmin(url, options = {}) {
    const saved = getToken()
    const headers = { ...(options.headers || {}), ...(saved ? { Authorization: `Basic ${saved}` } : {}) }
    let response = await fetch(url, { ...options, headers })
    if (response.status !== 401 && response.status !== 403) return response
    const credentials = prompt("Credenciales administrativas (usuario:clave):")
    if (!credentials) return response
    let token
    try { token = btoa(credentials) } catch { return response }
    try { localStorage.setItem("admin_token", token) } catch {}
    return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Basic ${token}` } })
  }

  async function load() {
    const response = await fetchAdmin("/api/admin/wholesale/products")
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`)
    const configById = new Map((data.products || []).map(item => [Number(item.productId), item]))
    rowsTarget.replaceChildren()
    for (const product of data.catalog || []) {
      if (product.catalogVisibility === "public") continue
      const config = configById.get(Number(product.id)) || {}
      const row = document.createElement("tr")
      row.className = "border-b border-sky-100"
      row.dataset.productId = String(product.id)
      row.innerHTML = `<td class="py-2 font-medium">${escapeHtml(product.name || "Producto")}${product.code ? `<span class="ml-1 text-xs text-slate-500">${escapeHtml(product.code)}</span>` : ""}</td>
        <td>${Number(config.unitsPerPackage || product.unitsBundle || 1)}</td>
        <td><input data-unit-price type="number" min="0" step="0.01" value="${config.unitWholesalePrice == null ? "" : Number(config.unitWholesalePrice)}" class="w-36 rounded border border-slate-300 px-2 py-1.5" aria-label="Precio por unidad de ${escapeHtml(product.name)}"><span class="ml-2 text-xs text-slate-500">Por unidad</span></td>`
      rowsTarget.appendChild(row)
    }
  }

  panel.querySelector("[data-save-unit-prices]").addEventListener("click", async event => {
    const saveButton = event.currentTarget
    const currentPrices = new Map(Array.from(rowsTarget.querySelectorAll("tr"), row => [
      Number(row.dataset.productId),
      row.querySelector("[data-unit-price]").value
    ]))
    const invalidPrice = [...currentPrices.values()].some(value => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))
    if (invalidPrice) return showStatus("Cada precio debe ser un número válido igual o mayor que cero.", true)
    saveButton.disabled = true
    try {
      const currentResponse = await fetchAdmin("/api/admin/wholesale/products")
      const currentData = await currentResponse.json().catch(() => ({}))
      if (!currentResponse.ok) throw new Error(currentData.error || `Error HTTP ${currentResponse.status}`)
      const productConfigs = (currentData.products || []).map(existing => ({
        ...existing,
        unitWholesalePrice: currentPrices.has(Number(existing.productId))
          ? currentPrices.get(Number(existing.productId)) === "" ? null : Number(currentPrices.get(Number(existing.productId)))
          : existing.unitWholesalePrice ?? null
      }))
      const configuredIds = new Set(productConfigs.map(item => Number(item.productId)))
      for (const [productId, unitPrice] of currentPrices) {
        if (configuredIds.has(productId) || unitPrice === "") continue
        productConfigs.push({
          productId,
          enabled: false,
          packageName: "Paquete",
          unitsPerPackage: 1,
          minimumQuantity: 1,
          wholesalePrice: null,
          packagePrice: null,
          availability: "Disponible",
          unitWholesalePrice: Number(unitPrice)
        })
      }
      const response = await fetchAdmin("/api/admin/wholesale/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: productConfigs })
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`)
      await load()
      showStatus("Precios unitarios guardados. Los productos con precio configurado ya pueden seleccionarse por unidad en el portal.")
    } catch (error) {
      showStatus(`No se pudieron guardar los precios unitarios: ${error.message}`, true)
    } finally {
      saveButton.disabled = false
    }
  })

  load().catch(error => showStatus(`No se pudieron cargar los precios unitarios: ${error.message}`, true))
})()
