(() => {
  const $ = id => document.getElementById(id)
  const state = { suppliers: [], productTerms: [], supplierCatalogItems: [], purchaseOrders: [], catalog: [], wholesaleOrders: [], forecast: null, dispatchCosts: null, priceListPreview: null, pdfDocument: null, pdfNextPage: 1, priceListPage: 0 }
  const money = value => `US$ ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character])

  function showStatus(message, isError = false) {
    const box = $("page-status")
    box.textContent = message
    box.className = `rounded-lg border px-4 py-3 text-sm ${isError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`
    box.classList.remove("hidden")
  }

  function getAdminToken() {
    try { return localStorage.getItem("admin_token") || "" } catch { return "" }
  }

  async function fetchAdmin(url, options = {}) {
    const saved = getAdminToken()
    const headers = { ...(options.headers || {}), ...(saved ? { Authorization: `Basic ${saved}` } : {}) }
    let response = await fetch(url, { ...options, headers })
    if (response.status !== 401 && response.status !== 403) return response
    const credentials = prompt("Credenciales administrativas (usuario:clave):")
    if (!credentials) return response
    let token
    try { token = btoa(credentials) } catch { return response }
    try { localStorage.setItem("admin_token", token) } catch {}
    response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Basic ${token}` } })
    return response
  }

  async function request(url, options = {}) {
    const response = await fetchAdmin(url, options)
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const minimum = result.minimumOrderAmount == null ? "" : ` Mínimo del proveedor: ${money(result.minimumOrderAmount)}.`
      const messages = {
        invalid_freight_cost: "El gasto de flete debe ser un monto válido no negativo",
        invalid_purchase_order_item: "Verifica los productos y mínimos de compra de la orden",
        supplier_minimum_order_not_met: "El subtotal de mercancía no alcanza el mínimo del proveedor",
        invalid_purchase_order_status_transition: "No se puede cambiar al estado solicitado",
        multiple_preferred_suppliers_for_product: "Solo puede haber un proveedor principal por producto.",
        invalid_price_list: "La lista debe incluir entre 1 y 5000 productos.",
        invalid_price_list_item: `La fila ${result.row || ""} contiene datos inválidos o productos repetidos.`,
        inconsistent_repeated_product: `La fila ${result.row || ""} repite el producto con precios o presentaciones base distintos.`,
        duplicate_discount_rule: `La fila ${result.row || ""} repite una misma regla de descuento.`,
        duplicate_price_list_row: `La fila ${result.row || ""} repite un producto sin una etapa de descuento distinta.`,
        supplier_not_found: "No se encontró el proveedor seleccionado."
      }
      throw new Error(`${messages[result.error] || result.error || `Error HTTP ${response.status}`}.${minimum}`)
    }
    return result
  }

  const supplierById = id => state.suppliers.find(supplier => supplier.id === id)
  const productById = id => state.catalog.find(product => Number(product.id) === Number(id))
  const termById = id => state.productTerms.find(term => term.id === id)

  function getReceivedLandedCost(productId, supplierId) {
    let totalCost = 0
    let totalUnits = 0
    for (const order of state.purchaseOrders) {
      if (order.status !== "received" || order.supplierId !== supplierId) continue
      for (const item of order.items || []) {
        if (Number(item.productId) !== Number(productId)) continue
        const units = Number(item.inventoryUnits || Number(item.quantity || 0) * Number(item.unitsPerPurchase || 1))
        if (!Number.isFinite(units) || units <= 0) continue
        const landedTotal = Number(item.landedTotal ?? (Number(item.subtotal || 0) + Number(item.freightAllocation || 0)))
        if (!Number.isFinite(landedTotal) || landedTotal < 0) continue
        totalUnits += units
        totalCost += landedTotal
      }
    }
    return totalUnits > 0 ? totalCost / totalUnits : null
  }

  function renderSummary() {
    const openOrders = state.purchaseOrders.filter(order => ["draft", "ordered"].includes(order.status))
    const freightOrdered = Number(state.dispatchCosts?.purchaseFreightOrdered || 0)
    const freightReceived = Number(state.dispatchCosts?.purchaseFreightReceived || 0)
    const dispatchFreightCharged = Number(state.dispatchCosts?.dispatchFreightCharged || 0)
    const dispatchFreightBalance = Number(state.dispatchCosts?.dispatchFreightBalance || 0)
    const metrics = [
      ["Proveedores activos", state.suppliers.filter(supplier => supplier.active).length],
      ["Costos registrados", state.productTerms.length],
      ["Artículos externos", state.supplierCatalogItems.length],
      ["Compras abiertas", `${openOrders.length} · ${money(openOrders.reduce((sum, order) => sum + Number(order.total || 0), 0))}`],
      ["Flete de compra solicitado", money(freightOrdered)],
      ["Flete de compra recibido", money(freightReceived)],
      ["Flete cobrado a clientes", money(dispatchFreightCharged)],
      ["Flete de despacho por rutas", money(state.dispatchCosts?.dispatchFreightRecorded)],
      ["Balance cobro vs. despacho", money(dispatchFreightBalance)],
      ["Flete logístico contabilizado", money(state.dispatchCosts?.logisticsFreightAccounted)]
    ]
    $("summary").innerHTML = metrics.map(([label, value]) => `<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(label)}</p><p class="mt-2 text-xl font-bold text-[#10165c]">${escapeHtml(value)}</p></article>`).join("")
  }

  function renderSelects() {
    const activeSuppliers = state.suppliers.filter(supplier => supplier.active)
    const supplierOptions = activeSuppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("")
    const priceListSupplier = $("price-list-supplier").value
    $("price-list-supplier").innerHTML = `<option value="">Selecciona proveedor…</option>${activeSuppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("")}`
    if (activeSuppliers.some(supplier => supplier.id === priceListSupplier)) $("price-list-supplier").value = priceListSupplier

    const comparisonSupplier = $("comparison-supplier").value
    $("comparison-supplier").innerHTML = `<option value="">Todos los proveedores</option>${activeSuppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("")}`
    if (activeSuppliers.some(supplier => supplier.id === comparisonSupplier)) $("comparison-supplier").value = comparisonSupplier

    const comparisonCategory = $("comparison-category").value
    const categories = [...new Set(state.catalog.map(product => String(product.category || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"))
    $("comparison-category").innerHTML = `<option value="">Todas las categorías</option>${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`
    if (categories.includes(comparisonCategory)) $("comparison-category").value = comparisonCategory

    const paymentMethod = $("comparison-payment-method").value
    const paymentMethods = [...new Set(state.productTerms.flatMap(term =>
      (Array.isArray(term.discountRules) ? term.discountRules : [])
        .map(rule => String(rule.paymentMethod || "").trim())
        .filter(Boolean)
    ))].sort((a, b) => a.localeCompare(b, "es"))
    $("comparison-payment-method").innerHTML = `<option value="">Sin descuento por método de pago</option>${paymentMethods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join("")}`
    if (paymentMethods.includes(paymentMethod)) $("comparison-payment-method").value = paymentMethod

    const currentOrderSupplier = $("order-supplier").value
    $("order-supplier").innerHTML = `<option value="">Selecciona proveedor…</option>${supplierOptions}`
    if (activeSuppliers.some(supplier => supplier.id === currentOrderSupplier)) $("order-supplier").value = currentOrderSupplier

    const currentSource = $("source-order").value
    $("source-order").innerHTML = `<option value="">Sin pedido asociado</option>${state.wholesaleOrders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.id)} · ${escapeHtml(order.clientName)}</option>`).join("")}`
    if (state.wholesaleOrders.some(order => order.id === currentSource)) $("source-order").value = currentSource
  }

  function clearSupplierForm() {
    $("supplier-form").reset()
    $("supplier-id").value = ""
    $("supplier-minimum").value = "0"
    $("supplier-payment-terms").value = ""
    $("supplier-delivery-terms").value = ""
    $("supplier-discount-application").value = "best"
    $("supplier-active").checked = true
  }

  function renderSuppliers() {
    $("suppliers-list").innerHTML = state.suppliers.length ? state.suppliers.map(supplier => {
      const productCount = state.productTerms.filter(term => term.supplierId === supplier.id).length
      return `
      <div class="flex flex-wrap items-center justify-between gap-2 py-3">
        <div><p class="font-semibold">${escapeHtml(supplier.name)} ${supplier.active ? "" : '<span class="text-xs text-slate-400">(inactivo)</span>'}</p>
          <p class="text-xs text-slate-500">${escapeHtml([supplier.contact, supplier.phone, supplier.email].filter(Boolean).join(" · ") || "Sin contacto")} · Mínimo ${money(supplier.minimumOrderAmount)}</p>
          <p class="text-xs text-slate-500">${escapeHtml([supplier.paymentTerms, supplier.deliveryTerms].filter(Boolean).join(" · ") || "Sin condiciones registradas")} · Descuentos ${supplier.discountApplication === "cumulative" ? "acumulados" : "mayor descuento"}</p>
          <p class="text-xs text-slate-500">${supplier.priceListName ? `Lista: ${escapeHtml(supplier.priceListName)} · ` : ""}${productCount} productos con precio · ${state.supplierCatalogItems.filter(item => item.supplierId === supplier.id).length} artículos externos${supplier.priceListUpdatedAt ? ` · Actualizada ${escapeHtml(new Date(supplier.priceListUpdatedAt).toLocaleDateString("es"))}` : ""}</p></div>
        <div class="flex gap-2"><button type="button" data-export-supplier="${escapeHtml(supplier.id)}" class="rounded border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-800">Exportar XLSX</button><button type="button" data-edit-supplier="${escapeHtml(supplier.id)}" class="rounded border px-3 py-1.5 text-xs font-semibold">Editar</button></div>
      </div>`
    }).join("") : '<p class="py-4 text-sm text-slate-500">Todavía no hay proveedores registrados.</p>'
  }

  function renderSupplierCatalogSearch() {
    const query = canonical($("supplier-catalog-search").value)
    const supplierId = $("supplier-catalog-filter").value
    const tokens = query.split(/[\s,./_-]+/).filter(Boolean)
    const entries = [
      ...state.productTerms.map(term => {
        const product = productById(term.productId) || {}
        return {
          ...term,
          kind: "Producto del catálogo comercial",
          productName: product.name || "Producto",
          productCode: product.code || product.sku || "",
          category: product.category || "",
          brand: product.brand || ""
        }
      }),
      ...state.supplierCatalogItems.map(item => ({
        ...item,
        kind: "Artículo externo · candidato",
        category: "",
        brand: ""
      }))
    ]
    const matches = entries.filter(item => {
      const supplier = supplierById(item.supplierId)
      const searchable = canonical(`${item.productName} ${item.productCode || ""} ${item.supplierSku || ""} ${item.category} ${item.brand} ${supplier?.name || ""}`)
      return (!supplierId || item.supplierId === supplierId) && (!tokens.length || tokens.every(token => searchable.includes(token)))
    }).sort((a, b) =>
      (supplierById(a.supplierId)?.name || "").localeCompare(supplierById(b.supplierId)?.name || "", "es") ||
      a.productName.localeCompare(b.productName, "es")
    )
    $("supplier-catalog-filter").innerHTML = `<option value="">Todos los proveedores</option>${state.suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("")}`
    if (state.suppliers.some(supplier => supplier.id === supplierId)) $("supplier-catalog-filter").value = supplierId
    const visibleMatches = matches.slice(0, 200)
    $("supplier-catalog-results").innerHTML = visibleMatches.length ? `
      <p class="mb-2 text-xs text-slate-500">Mostrando ${visibleMatches.length} de ${matches.length} coincidencias</p>
      <div class="overflow-x-auto rounded-lg border"><table class="w-full min-w-[820px] text-left text-sm">
        <thead class="bg-slate-100 text-xs uppercase text-slate-600"><tr><th class="p-2">Producto / catálogo</th><th class="p-2">Proveedor y condiciones</th><th class="p-2">Costo / presentación</th><th class="p-2">Mínimo / empaque</th><th class="p-2">Descuentos</th><th class="p-2">Verificado</th></tr></thead>
        <tbody>${visibleMatches.map(item => {
          const supplier = supplierById(item.supplierId) || {}
          const discounts = (item.discountRules || []).map(rule => `${Number(rule.percentage)}%${rule.minimumQuantity ? ` desde ${Number(rule.minimumQuantity)} compras` : ""}${rule.minimumAmount ? ` · monto ${money(rule.minimumAmount)}` : ""}${rule.paymentMethod ? ` · ${escapeHtml(rule.paymentMethod)}` : ""}`).join("<br>")
          return `<tr class="border-t"><td class="p-2"><strong>${escapeHtml(item.productName)}</strong><span class="block text-xs text-slate-500">${escapeHtml([item.productCode, item.supplierSku, item.brand, item.category].filter(Boolean).join(" · ") || "Sin código")}</span><span class="text-xs ${item.kind.startsWith("Artículo externo") ? "text-amber-800" : "text-emerald-800"}">${escapeHtml(item.kind)}</span></td><td class="p-2">${escapeHtml(supplier.name || "Proveedor")}<span class="block text-xs text-slate-500">${escapeHtml([supplier.paymentTerms, supplier.deliveryTerms].filter(Boolean).join(" · ") || "Sin condiciones registradas")}</span><span class="block text-xs text-slate-500">Mínimo proveedor: ${money(supplier.minimumOrderAmount)}</span></td><td class="p-2">${money(item.unitCost)} / ${escapeHtml(item.purchaseUnit)}</td><td class="p-2">${Number(item.minimumQuantity)} ${escapeHtml(item.purchaseUnit)} · ${Number(item.unitsPerPurchase)} unidades/empaque</td><td class="p-2">${discounts || "Sin descuentos estructurados"}</td><td class="p-2">${item.priceVerifiedAt ? escapeHtml(new Date(item.priceVerifiedAt).toLocaleDateString("es")) : "—"}</td></tr>`
        }).join("")}</tbody>
      </table></div>` : `<p class="rounded-lg border border-dashed p-5 text-sm text-slate-500">${tokens.length ? "No se encontraron productos ni artículos de proveedores con esos términos." : "Aún no hay precios de proveedores. Al cargar listas y registrar condiciones aparecerán aquí tanto los productos del catálogo comercial como los artículos externos."}</p>`
  }

  function renderTermFilters() {
    const categorySelect = $("terms-category")
    const supplierSelect = $("terms-supplier")
    const category = categorySelect.value
    const supplierId = supplierSelect.value
    const categories = [...new Set(state.catalog.map(product => String(product.category || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "es"))
    categorySelect.innerHTML = `<option value="">Todas las categorías</option>${categories.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`
    supplierSelect.innerHTML = `<option value="">Todos los proveedores</option>${state.suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("")}`
    if (categories.includes(category)) categorySelect.value = category
    if (state.suppliers.some(supplier => supplier.id === supplierId)) supplierSelect.value = supplierId
  }

  function renderTerms() {
    const query = $("terms-search").value.trim().toLocaleLowerCase("es")
    const category = $("terms-category").value
    const supplierId = $("terms-supplier").value
    const terms = state.productTerms.filter(term => {
        const product = productById(term.productId) || {}
        const supplier = supplierById(term.supplierId) || {}
        const haystack = `${product.name || ""} ${product.code || ""} ${product.brand || ""} ${supplier.name || ""} ${term.supplierSku || ""}`.toLocaleLowerCase("es")
        return (!query || haystack.includes(query)) && (!category || product.category === category) && (!supplierId || term.supplierId === supplierId)
    })
    $("terms-count").textContent = `Mostrando ${terms.length} de ${state.productTerms.length} condiciones`
    $("terms-list").innerHTML = terms.length ? terms.map(term => {
        const product = productById(term.productId) || {}
        const supplier = supplierById(term.supplierId) || {}
      const baseUnitCost = Number(term.unitCost) / Math.max(1, Number(term.unitsPerPurchase))
      const receivedUnitCost = getReceivedLandedCost(term.productId, term.supplierId)
      const salePrice = Number(product.price)
      const hasSalePrice = product.price != null && Number.isFinite(salePrice)
      const margin = hasSalePrice ? salePrice - (receivedUnitCost ?? baseUnitCost) : null
      const discountRules = (Array.isArray(term.discountRules) ? term.discountRules : []).map(rule => {
        const conditions = [
          Number(rule.minimumQuantity) > 0 ? `desde ${Number(rule.minimumQuantity)} ${term.purchaseUnit}` : "",
          Number(rule.minimumAmount) > 0 ? `monto ${money(rule.minimumAmount)}` : "",
          rule.paymentMethod || ""
        ].filter(Boolean)
        return `${conditions.join(" · ") || "Etapa"}: ${Number(rule.percentage).toFixed(2)}%`
      })
      return `<tr class="border-b">
        <td class="py-3"><p class="font-semibold">${escapeHtml(product.name || "Producto")}${term.preferredSupplier ? ' <span class="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">Principal</span>' : ""}</p><p class="text-xs text-slate-500">${escapeHtml(supplier.name || "Proveedor")} · ${escapeHtml(term.supplierSku || "Sin código proveedor")} · Precio verificado ${term.priceVerifiedAt ? escapeHtml(new Date(term.priceVerifiedAt).toLocaleDateString("es")) : "sin fecha registrada"}</p></td>
        <td>${money(term.unitCost)} / ${escapeHtml(term.purchaseUnit)}</td>
        <td>${money(baseUnitCost)}</td>
        <td>${receivedUnitCost == null ? '<span class="text-xs text-slate-500">Sin recepción</span>' : `${money(receivedUnitCost)}${margin == null ? "" : `<span class="block text-xs ${margin >= 0 ? "text-emerald-700" : "text-rose-700"}">Margen vs. venta: ${money(margin)}</span>`}`}</td>
        <td>${Number(term.minimumQuantity)} ${escapeHtml(term.purchaseUnit)}${Number(term.unitsPerPurchase) > 1 ? `<span class="block text-xs text-slate-500">× ${Number(term.unitsPerPurchase)} unidades</span>` : ""}</td>
        <td>${discountRules.length ? discountRules.map(rule => `<span class="block text-xs">${escapeHtml(rule)}</span>`).join("") : '<span class="text-xs text-slate-500">Sin descuentos</span>'}</td>
        <td>${term.preferredSupplier ? "Sí" : "—"}</td>
      </tr>`
    }).join("") : `<tr><td colspan="7" class="py-4 text-sm text-slate-500">${state.productTerms.length ? "No hay costos que coincidan con los filtros." : "Aún no hay condiciones de compra. Configúralas desde los productos mayoristas."}</td></tr>`
  }

  function canonical(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es").replace(/\s+/g, " ")
  }

  function resolveImportProduct(value, supplierId) {
    const query = canonical(value)
    if (!query) return null
    const exactLabels = state.catalog.filter(product => canonical(`${product.name || "Producto"} (${product.code || product.id})`) === query)
    if (exactLabels.length === 1) return exactLabels[0]
    const codeMatches = state.catalog.filter(product =>
      [product.code, product.sku].some(code => canonical(code) === query) ||
      state.productTerms.some(term => term.supplierId === supplierId && Number(term.productId) === Number(product.id) && canonical(term.supplierSku) === query)
    )
    if (codeMatches.length === 1) return codeMatches[0]
    const nameMatches = state.catalog.filter(product => canonical(product.name) === query)
    return nameMatches.length === 1 ? nameMatches[0] : null
  }

  function parseCsv(text, delimiter) {
    const rows = []
    let row = []
    let field = ""
    let quoted = false
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"'
          index += 1
        } else if (character === '"') {
          quoted = false
        } else {
          field += character
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true
      } else if (character === delimiter) {
        row.push(field.trim())
        field = ""
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1
        row.push(field.trim())
        if (row.some(value => value !== "")) rows.push(row)
        row = []
        field = ""
      } else {
        field += character
      }
    }
    if (quoted) throw new Error("El CSV tiene una comilla sin cerrar.")
    row.push(field.trim())
    if (row.some(value => value !== "")) rows.push(row)
    return rows
  }

  function parseListNumber(value, fallback) {
    if (value == null || String(value).trim() === "") return fallback
    let normalized = String(value).replace(/[^\d,.-]/g, "")
    if (normalized.includes(",") && normalized.includes(".")) {
      normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "")
    } else if (normalized.includes(",")) {
      normalized = /^-?\d{1,3}(,\d{3})+$/.test(normalized)
        ? normalized.replace(/,/g, "")
        : normalized.replace(",", ".")
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, "")
    }
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : NaN
  }

  function getInvalidDiscountProductIds(rows) {
    const groups = new Map()
    for (const row of rows) {
      const key = row.productId ? `product:${row.productId}` : `external:${canonical(row.supplierSku || row.productCode || row.productName)}`
      if (key === "external:") continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    const invalid = new Set()
    for (const [productKey, productRows] of groups) {
      if (productRows.length < 2) continue
      const base = productRows[0]
      const signatures = new Set()
      let baseRows = 0
      const inconsistent = productRows.some(row =>
        Number(row.unitCost) !== Number(base.unitCost) ||
        row.purchaseUnit !== base.purchaseUnit ||
        Number(row.unitsPerPurchase) !== Number(base.unitsPerPurchase) ||
        Number(row.minimumQuantity) !== Number(base.minimumQuantity) ||
        row.supplierSku !== base.supplierSku
      )
      for (const row of productRows) {
        if (Number(row.discountPercentage) <= 0) {
          baseRows += 1
          continue
        }
        const signature = [
          Number(row.discountMinimumQuantity),
          Number(row.discountMinimumAmount),
          canonical(row.paymentMethod),
          Number(row.discountPercentage)
        ].join("|")
        if (signatures.has(signature)) invalid.add(productKey)
        signatures.add(signature)
      }
      if (inconsistent || baseRows > 1 || !signatures.size) invalid.add(productKey)
    }
    return invalid
  }

  async function preparePriceList() {
    const file = $("price-list-file").files[0]
    const supplierId = $("price-list-supplier").value
    if (!supplierId) throw new Error("Selecciona el proveedor de esta lista.")
    if (!file) throw new Error("Selecciona un archivo CSV.")
    if (file.name.toLowerCase().endsWith(".pdf")) {
      if (file.size > 50 * 1024 * 1024) throw new Error("Por seguridad, el PDF no puede superar 50 MB.")
      await discardPdfDocument()
      const pdfjs = await import("/vendor/pdfjs/pdf.mjs")
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.mjs"
      const pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
      if (pdfDocument.numPages > 500) {
        await pdfDocument.destroy()
        throw new Error("El límite de procesamiento es 500 páginas por archivo.")
      }
      state.pdfDocument = pdfDocument
      state.pdfNextPage = 1
      state.priceListPage = 0
      state.priceListPreview = { supplierId, sourceName: file.name, rows: [], sourceKeys: new Set(), totalPages: pdfDocument.numPages, complete: false }
      $("pdf-batch-controls").classList.remove("hidden")
      $("pdf-batch-controls").classList.add("flex")
      $("extract-pdf-batch").disabled = false
      updatePdfProgress()
      await extractPdfBatch()
      return
    }
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 2 * 1024 * 1024) {
      throw new Error("Usa un archivo CSV de hasta 2 MB o un PDF de hasta 50 MB.")
    }
    await discardPdfDocument()
    $("pdf-batch-controls").classList.add("hidden")
    $("pdf-batch-controls").classList.remove("flex")
    const text = (await file.text()).replace(/^\uFEFF/, "")
    const firstLine = text.split(/\r?\n/, 1)[0] || ""
    const commaCount = (firstLine.match(/,/g) || []).length
    const semicolonCount = (firstLine.match(/;/g) || []).length
    const rows = parseCsv(text, semicolonCount > commaCount ? ";" : ",")
    if (rows.length < 2 || rows.length > 5001) throw new Error("El CSV debe tener encabezados y entre 1 y 5000 productos.")
    const headers = rows[0].map(canonical)
    const findColumn = aliases => headers.findIndex(header => aliases.includes(header))
    const nameColumn = findColumn(["producto", "nombre", "nombre producto", "descripcion", "descripcion producto", "description", "name", "articulo"])
    const codeColumn = findColumn(["codigo", "codigo producto", "code", "sku", "referencia"])
    const priceColumn = findColumn(["precio", "precio unitario", "costo", "costo unitario", "precio compra", "cost", "price", "unitcost"])
    if (priceColumn < 0 || (nameColumn < 0 && codeColumn < 0)) {
      throw new Error("No se reconocieron las columnas. Incluye nombre o código del producto y precio.")
    }
    const supplierSkuColumn = findColumn(["codigo proveedor", "sku proveedor", "referencia proveedor", "supplier sku", "suppliersku"])
    const unitColumn = findColumn(["unidad", "unidad compra", "presentacion", "presentacion compra", "purchase unit"])
    const unitsColumn = findColumn(["unidades por compra", "unidades por empaque", "unidades empaque", "units per purchase", "unitsperpurchase"])
    const minimumColumn = findColumn(["minimo", "cantidad minima", "minimo compra", "minimum quantity", "minimumquantity"])
    const discountQuantityColumn = findColumn(["cantidad minima descuento", "cantidad desde descuento", "etapa cantidad", "descuento desde cantidad", "discount minimum quantity", "discountminimumquantity"])
    const discountAmountColumn = findColumn(["monto minimo descuento", "monto desde descuento", "etapa monto", "descuento desde monto", "discount minimum amount", "discountminimumamount"])
    const paymentMethodColumn = findColumn(["metodo de pago descuento", "forma de pago descuento", "metodo de pago", "payment method", "paymentmethod"])
    const discountColumn = findColumn(["descuento porcentaje", "descuento %", "descuento", "discount percentage", "discount percent", "discountpercentage"])
    const previewRows = rows.slice(1).map((cells, index) => {
      const productCode = codeColumn < 0 ? "" : String(cells[codeColumn] || "").trim()
      const productName = (nameColumn < 0 ? "" : String(cells[nameColumn] || "").trim()) || productCode
      const supplierSku = supplierSkuColumn < 0 ? productCode : String(cells[supplierSkuColumn] || "").trim()
      const product = resolveImportProduct(productCode || productName, supplierId) ||
        (productName ? resolveImportProduct(productName, supplierId) : null)
      const unitCost = parseListNumber(cells[priceColumn], NaN)
      const unitsPerPurchase = parseListNumber(unitsColumn < 0 ? "" : cells[unitsColumn], 1)
      const minimumQuantity = parseListNumber(minimumColumn < 0 ? "" : cells[minimumColumn], 1)
      return {
        rowNumber: index + 2,
        productId: product ? Number(product.id) : null,
        external: !product,
        productName,
        productCode,
        productChoice: product ? `${product.name || "Producto"} (${product.code || product.id})` : productCode || productName,
        supplierSku,
        unitCost,
        purchaseUnit: String(unitColumn < 0 ? "" : cells[unitColumn] || "unidad").trim() || "unidad",
        unitsPerPurchase,
        minimumQuantity,
        discountMinimumQuantity: parseListNumber(discountQuantityColumn < 0 ? "" : cells[discountQuantityColumn], 0),
        discountMinimumAmount: parseListNumber(discountAmountColumn < 0 ? "" : cells[discountAmountColumn], 0),
        paymentMethod: String(paymentMethodColumn < 0 ? "" : cells[paymentMethodColumn] || "").trim(),
        discountPercentage: parseListNumber(discountColumn < 0 ? "" : String(cells[discountColumn] || "").replace("%", ""), 0)
      }
    })
    state.priceListPage = 0
    state.priceListPreview = { supplierId, sourceName: file.name, rows: previewRows, complete: true }
    renderPriceListPreview()
  }

  function updatePdfProgress() {
    const preview = state.priceListPreview
    if (!preview || !preview.totalPages) return
    const processed = Math.min(state.pdfNextPage - 1, preview.totalPages)
    $("pdf-progress").textContent = `PDF leído localmente · ${processed} de ${preview.totalPages} páginas · ${preview.rows.length} renglones detectados`
    $("extract-pdf-batch").textContent = processed >= preview.totalPages ? "Extracción completa" : `Extraer páginas ${state.pdfNextPage}–${Math.min(preview.totalPages, state.pdfNextPage + 19)}`
    $("extract-pdf-batch").disabled = processed >= preview.totalPages
  }

  async function extractPdfBatch() {
    const preview = state.priceListPreview
    const document = state.pdfDocument
    if (!preview || !document || state.pdfNextPage > preview.totalPages) return
    const endPage = Math.min(preview.totalPages, state.pdfNextPage + 19)
    $("extract-pdf-batch").disabled = true
    try {
      for (let pageNumber = state.pdfNextPage; pageNumber <= endPage; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        const lineMap = new Map()
        for (const item of content.items) {
          if (!item.str || !item.str.trim()) continue
          const y = Math.round(item.transform[5] / 3) * 3
          if (!lineMap.has(y)) lineMap.set(y, [])
          lineMap.get(y).push({ x: item.transform[4], text: item.str.trim() })
        }
        for (const parts of lineMap.values()) {
          parts.sort((left, right) => left.x - right.x)
          let line = ""
          let previousX = null
          for (const part of parts) {
            if (previousX != null && part.x - previousX > 24) line += "  "
            else if (line && !line.endsWith(" ")) line += " "
            line += part.text
            previousX = part.x
          }
          const match = line.match(/(?:[$€£]\s*)?(-?\d[\d.,]*)\s*(?:USD|EUR|€)?\s*$/i)
          if (!match) continue
          const unitCost = parseListNumber(match[1], NaN)
          const productText = line.slice(0, match.index).replace(/[|·–—-]\s*$/, "").trim()
          if (!productText || !Number.isFinite(unitCost) || unitCost < 0) continue
          const product = resolveImportProduct(productText, preview.supplierId)
          const existingKey = `${pageNumber}:${canonical(productText)}:${unitCost}`
          if (preview.sourceKeys.has(existingKey)) continue
          preview.sourceKeys.add(existingKey)
          preview.rows.push({
            rowNumber: preview.rows.length + 1,
            pageNumber,
            sourceKey: existingKey,
            productId: product ? Number(product.id) : null,
            external: !product,
            productName: productText,
            productCode: "",
            productChoice: product ? `${product.name || "Producto"} (${product.code || product.id})` : productText,
            supplierSku: "",
            unitCost,
            purchaseUnit: "unidad",
            unitsPerPurchase: 1,
            minimumQuantity: 1,
            discountMinimumQuantity: 0,
            discountMinimumAmount: 0,
            paymentMethod: "",
            discountPercentage: 0
          })
          if (preview.rows.length > 5000) throw new Error("Se detectaron más de 5000 renglones. Divide el catálogo en archivos más pequeños.")
        }
        page.cleanup()
        state.pdfNextPage = pageNumber + 1
        updatePdfProgress()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      preview.complete = state.pdfNextPage > preview.totalPages
      if (preview.rows.length === 0 && endPage === preview.totalPages) {
        throw new Error("No se encontró texto con precios en el PDF. Puede ser un escaneo o tener un formato no compatible; no se modificó ningún costo.")
      }
      if (preview.rows.length > 0) renderPriceListPreview()
      updatePdfProgress()
    } finally {
      if (state.pdfNextPage <= preview.totalPages) $("extract-pdf-batch").disabled = false
    }
  }

  async function discardPdfDocument() {
    if (state.pdfDocument) {
      await state.pdfDocument.destroy()
      state.pdfDocument = null
    }
    state.pdfNextPage = 1
  }

  function renderPriceListPreview() {
    const preview = state.priceListPreview
    if (!preview) {
      $("price-list-preview").replaceChildren()
      return
    }
    const options = state.catalog.map(product =>
      `<option value="${escapeHtml(`${product.name || "Producto"} (${product.code || product.id})`)}"></option>`
    ).join("")
    const invalidDuplicateIds = getInvalidDiscountProductIds(preview.rows)
    const invalidCount = preview.rows.filter(row =>
      (!row.productId && (!row.external || !String(row.productName || "").trim())) || !Number.isFinite(row.unitCost) || row.unitCost < 0 ||
      !Number.isInteger(row.unitsPerPurchase) || row.unitsPerPurchase < 1 ||
      !Number.isInteger(row.minimumQuantity) || row.minimumQuantity < 1 ||
      !Number.isInteger(row.discountMinimumQuantity) || row.discountMinimumQuantity < 0 ||
      !Number.isFinite(row.discountMinimumAmount) || row.discountMinimumAmount < 0 ||
      !Number.isFinite(row.discountPercentage) || row.discountPercentage < 0 || row.discountPercentage > 100 ||
      (row.discountPercentage > 0 && !row.discountMinimumQuantity && !row.discountMinimumAmount && !row.paymentMethod) ||
      !row.purchaseUnit || invalidDuplicateIds.has(row.productId ? `product:${row.productId}` : `external:${canonical(row.supplierSku || row.productCode || row.productName)}`)
    ).length
    const pageSize = 100
    const pageCount = Math.max(1, Math.ceil(preview.rows.length / pageSize))
    state.priceListPage = Math.min(state.priceListPage, pageCount - 1)
    const pageStart = state.priceListPage * pageSize
    const visibleRows = preview.rows.slice(pageStart, pageStart + pageSize)
    $("price-list-preview").innerHTML = `
      <datalist id="price-list-products">${options}</datalist>
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-violet-50 p-3 text-sm">
        <span>${escapeHtml(preview.sourceName)} · ${preview.rows.length} filas${preview.totalPages ? ` · ${Math.min(state.pdfNextPage - 1, preview.totalPages)}/${preview.totalPages} páginas` : ""} · ${!preview.complete ? "continúa la extracción para completar el PDF" : invalidCount ? `${invalidCount} requieren revisión` : "lista lista para confirmar"}</span>
        <button id="apply-price-list" type="button" ${invalidCount || !preview.complete ? "disabled" : ""} class="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Confirmar y actualizar costos</button>
      </div>
      <div class="flex items-center justify-between gap-2 text-sm">
        <button type="button" data-import-page="${state.priceListPage - 1}" ${state.priceListPage === 0 ? "disabled" : ""} class="rounded border px-3 py-1 disabled:opacity-40">Anterior</button>
        <span>Filas ${preview.rows.length ? pageStart + 1 : 0}–${Math.min(pageStart + pageSize, preview.rows.length)} de ${preview.rows.length} · Página ${state.priceListPage + 1}/${pageCount}</span>
        <button type="button" data-import-page="${state.priceListPage + 1}" ${state.priceListPage >= pageCount - 1 ? "disabled" : ""} class="rounded border px-3 py-1 disabled:opacity-40">Siguiente</button>
      </div>
      <div class="max-h-[32rem] overflow-auto rounded-lg border">
        <table class="w-full min-w-[1000px] text-left text-xs">
          <thead class="sticky top-0 bg-slate-100"><tr><th class="p-2">Fila / página</th><th class="p-2">Producto del sistema (nombre o código exacto)</th><th class="p-2">Costo</th><th class="p-2">Unidad compra</th><th class="p-2">Unidades/compra</th><th class="p-2">Mínimo</th><th class="p-2">Código proveedor</th><th class="p-2">Cantidad desde</th><th class="p-2">Monto desde</th><th class="p-2">Método de pago</th><th class="p-2">Descuento %</th></tr></thead>
          <tbody>${visibleRows.map((row, visibleIndex) => {
            const index = pageStart + visibleIndex
            const duplicateKey = row.productId ? `product:${row.productId}` : `external:${canonical(row.supplierSku || row.productCode || row.productName)}`
            const duplicate = invalidDuplicateIds.has(duplicateKey)
            const invalid = (!row.productId && (!row.external || !String(row.productName || "").trim())) || !Number.isFinite(row.unitCost) || row.unitCost < 0 ||
              !Number.isInteger(row.unitsPerPurchase) || row.unitsPerPurchase < 1 ||
              !Number.isInteger(row.minimumQuantity) || row.minimumQuantity < 1 ||
              !Number.isInteger(row.discountMinimumQuantity) || row.discountMinimumQuantity < 0 ||
              !Number.isFinite(row.discountMinimumAmount) || row.discountMinimumAmount < 0 ||
              !Number.isFinite(row.discountPercentage) || row.discountPercentage < 0 || row.discountPercentage > 100 ||
              (row.discountPercentage > 0 && !row.discountMinimumQuantity && !row.discountMinimumAmount && !row.paymentMethod) || duplicate
            return `<tr class="border-t ${invalid ? "bg-rose-50" : ""}">
              <td class="p-2">${row.pageNumber ? `Pág. ${row.pageNumber}` : row.rowNumber}</td>
              <td class="p-2"><input data-import-product="${index}" list="price-list-products" value="${escapeHtml(row.productChoice)}" class="w-full rounded border px-2 py-1" aria-label="Producto del sistema para fila ${row.rowNumber}">${!row.productId ? `<label class="mt-1 flex items-center gap-1 text-xs text-amber-900"><input type="checkbox" data-import-external="${index}" ${row.external ? "checked" : ""}> Guardar como artículo externo (no se agrega a productos)</label>` : ""}<span class="block text-rose-700">${duplicate ? "Revisa las etapas repetidas o datos base distintos" : ""}</span></td>
              <td class="p-2"><input data-import-field="unitCost" data-import-index="${index}" type="number" min="0" step="0.01" value="${escapeHtml(row.unitCost)}" class="w-24 rounded border px-2 py-1" aria-label="Costo de compra"></td>
              <td class="p-2"><input data-import-field="purchaseUnit" data-import-index="${index}" value="${escapeHtml(row.purchaseUnit)}" class="w-24 rounded border px-2 py-1" aria-label="Unidad de compra"></td>
              <td class="p-2"><input data-import-field="unitsPerPurchase" data-import-index="${index}" type="number" min="1" step="1" value="${escapeHtml(row.unitsPerPurchase)}" class="w-20 rounded border px-2 py-1" aria-label="Unidades por compra"></td>
              <td class="p-2"><input data-import-field="minimumQuantity" data-import-index="${index}" type="number" min="1" step="1" value="${escapeHtml(row.minimumQuantity)}" class="w-20 rounded border px-2 py-1" aria-label="Cantidad mínima"></td>
              <td class="p-2"><input data-import-field="supplierSku" data-import-index="${index}" value="${escapeHtml(row.supplierSku)}" class="w-28 rounded border px-2 py-1" aria-label="Código del proveedor"></td>
              <td class="p-2"><input data-import-field="discountMinimumQuantity" data-import-index="${index}" type="number" min="0" step="1" value="${escapeHtml(row.discountMinimumQuantity)}" class="w-20 rounded border px-2 py-1" aria-label="Cantidad mínima para descuento"></td>
              <td class="p-2"><input data-import-field="discountMinimumAmount" data-import-index="${index}" type="number" min="0" step="0.01" value="${escapeHtml(row.discountMinimumAmount)}" class="w-24 rounded border px-2 py-1" aria-label="Monto mínimo para descuento"></td>
              <td class="p-2"><input data-import-field="paymentMethod" data-import-index="${index}" value="${escapeHtml(row.paymentMethod)}" class="w-28 rounded border px-2 py-1" aria-label="Método de pago del descuento"></td>
              <td class="p-2"><input data-import-field="discountPercentage" data-import-index="${index}" type="number" min="0" max="100" step="0.01" value="${escapeHtml(row.discountPercentage)}" class="w-20 rounded border px-2 py-1" aria-label="Descuento porcentual"></td>
            </tr>`
          }).join("")}</tbody>
        </table>
      </div>
      <div class="flex items-center justify-between gap-2 text-sm">
        <button type="button" data-import-page="${state.priceListPage - 1}" ${state.priceListPage === 0 ? "disabled" : ""} class="rounded border px-3 py-1 disabled:opacity-40">Anterior</button>
        <span>Página ${state.priceListPage + 1}/${pageCount}</span>
        <button type="button" data-import-page="${state.priceListPage + 1}" ${state.priceListPage >= pageCount - 1 ? "disabled" : ""} class="rounded border px-3 py-1 disabled:opacity-40">Siguiente</button>
      </div>
      <p class="text-xs text-slate-500">La lista vigente no cambia hasta confirmar. Se actualizan los productos incluidos; los que no aparezcan conservan su último precio verificado. Las órdenes y el catálogo comercial se conservan.</p>`
  }

  async function applyPriceList() {
    const preview = state.priceListPreview
    if (!preview) return
    if (!preview.complete) throw new Error("Termina de extraer todas las páginas del PDF antes de actualizar la lista.")
    const supplier = supplierById(preview.supplierId)
    if (!supplier) throw new Error("El proveedor de la vista previa ya no existe.")
    const invalidDuplicateIds = getInvalidDiscountProductIds(preview.rows)
    if (preview.rows.some(row =>     (!row.productId && (!row.external || !String(row.productName || "").trim())) ||
    invalidDuplicateIds.has(row.productId ? `product:${row.productId}` : `external:${canonical(row.supplierSku || row.productCode || row.productName)}`) ||
      !Number.isFinite(row.unitCost) || row.unitCost < 0 ||
      !Number.isInteger(row.unitsPerPurchase) || row.unitsPerPurchase < 1 ||
      !Number.isInteger(row.minimumQuantity) || row.minimumQuantity < 1 ||
      !Number.isInteger(row.discountMinimumQuantity) || row.discountMinimumQuantity < 0 ||
      !Number.isFinite(row.discountMinimumAmount) || row.discountMinimumAmount < 0 ||
      !Number.isFinite(row.discountPercentage) || row.discountPercentage < 0 || row.discountPercentage > 100 ||
      (row.discountPercentage > 0 && !row.discountMinimumQuantity && !row.discountMinimumAmount && !row.paymentMethod))) {
      throw new Error("Asocia cada fila con un producto existente o márcala como artículo externo; corrige también las filas repetidas o inválidas.")
    }
    const updatedCount = new Set(preview.rows.filter(row => row.productId).map(row => Number(row.productId))).size
    const externalCount = new Set(preview.rows.filter(row => !row.productId && row.external).map(row => canonical(row.supplierSku || row.productCode || row.productName))).size
    if (!confirm(`Se actualizarán ${updatedCount} productos existentes y se guardarán ${externalCount} artículos en el catálogo separado de ${supplier.name}. Los artículos externos no se agregarán al catálogo comercial; los precios omitidos conservarán su último registro. No se modificarán precios de venta, imágenes, órdenes ni datos de otros proveedores. ¿Continuar?`)) return
    const result = await request("/api/admin/procurement/price-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: preview.supplierId,
        sourceName: preview.sourceName,
        items: preview.rows.map(row => ({
          productId: row.productId,
          external: !row.productId && row.external === true,
          productName: row.productName,
          productCode: row.productCode,
          supplierSku: row.supplierSku,
          unitCost: row.unitCost,
          purchaseUnit: row.purchaseUnit,
          unitsPerPurchase: row.unitsPerPurchase,
          minimumQuantity: row.minimumQuantity,
          discountMinimumQuantity: row.discountMinimumQuantity,
          discountMinimumAmount: row.discountMinimumAmount,
          paymentMethod: row.paymentMethod,
          discountPercentage: row.discountPercentage
        }))
      })
    })
    state.priceListPreview = null
    await discardPdfDocument()
    $("price-list-file").value = ""
    $("pdf-batch-controls").classList.add("hidden")
    $("pdf-batch-controls").classList.remove("flex")
    renderPriceListPreview()
    await load()
    showStatus(`Lista de ${supplier.name} actualizada: ${result.importedCount} precios del catálogo comercial, ${result.importedExternalCount} artículos externos guardados y ${result.retainedCount} precios anteriores conservados. No se almacenó el archivo original.`)
  }

  function getComparisonProductMatches(query) {
    const category = $("comparison-category").value
    const tokens = canonical(query).split(/[\s,./_-]+/).filter(Boolean)
    if (!tokens.length) return []
    const selectedIds = new Set(Array.from($("comparison-items").querySelectorAll("[data-product-id]"))
      .map(row => String(row.dataset.productId)))
    return state.catalog.map(product => {
      if (category && String(product.category || "").trim() !== category) return null
      const name = canonical(product.name)
      const code = canonical(product.code || product.sku)
      const details = canonical(`${product.brand || ""} ${product.category || ""} ${product.subcategory || ""} ${product.desc || ""}`)
      const searchable = `${name} ${code} ${details}`
      if (tokens.some(token => !searchable.includes(token))) return null
      let score = 10
      if (name === canonical(query) || code === canonical(query)) score += 100
      else if (name.startsWith(canonical(query)) || code.startsWith(canonical(query))) score += 60
      else if (name.includes(canonical(query)) || code.includes(canonical(query))) score += 35
      if (state.productTerms.some(term => Number(term.productId) === Number(product.id))) score += 5
      return selectedIds.has(String(product.id)) ? null : { product, score }
    }).filter(Boolean)
      .sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(String(right.product.name), "es"))
      .slice(0, 10)
  }

  function makeComparisonItem() {
    const row = document.createElement("div")
    row.className = "grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
    row.dataset.comparisonItem = ""
    const productSearch = document.createElement("input")
    productSearch.type = "search"
    productSearch.placeholder = "Escribe nombre, código, marca o categoría…"
    productSearch.autocomplete = "off"
    productSearch.className = "min-w-0 rounded-lg border bg-white px-3 py-2 text-sm"
    productSearch.setAttribute("aria-label", "Buscar producto para comparar")
    const suggestions = document.createElement("div")
    suggestions.className = "hidden max-h-64 overflow-auto rounded-lg border bg-white shadow-lg sm:col-span-3"
    suggestions.dataset.productSuggestions = ""
    const quantity = document.createElement("input")
    quantity.type = "number"
    quantity.min = "1"
    quantity.step = "1"
    quantity.value = "1"
    quantity.className = "rounded-lg border px-3 py-2 text-sm"
    quantity.setAttribute("aria-label", "Cantidad requerida en unidades")
    const remove = document.createElement("button")
    remove.type = "button"
    remove.textContent = "Quitar"
    remove.className = "rounded border border-rose-200 px-3 py-2 text-sm text-rose-700"
    remove.addEventListener("click", () => { row.remove(); renderComparisonResults() })
    productSearch.addEventListener("input", () => {
      row.dataset.productId = ""
      const matches = getComparisonProductMatches(productSearch.value)
      suggestions.innerHTML = matches.length ? matches.map(({ product }) =>
        `<button type="button" data-select-comparison-product="${escapeHtml(product.id)}" class="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-amber-50">
          <span class="font-semibold">${escapeHtml(product.name || "Producto")}</span>
          <span class="block text-xs text-slate-500">${escapeHtml([product.code || product.sku, product.brand, product.category].filter(Boolean).join(" · "))}</span>
        </button>`
      ).join("") : `<p class="px-3 py-2 text-sm text-slate-500">${productSearch.value.trim() ? "No se encontraron coincidencias. Prueba con otro nombre, código o categoría." : "Escribe para buscar en el catálogo."}</p>`
      suggestions.classList.remove("hidden")
      renderComparisonResults()
    })
    quantity.addEventListener("input", renderComparisonResults)
    row.append(productSearch, quantity, remove, suggestions)
    return row
  }

  function getComparisonData() {
    const selected = Array.from($("comparison-items").querySelectorAll("[data-comparison-item]"))
      .map(row => ({
        product: productById(row.dataset.productId),
        quantity: Number(row.querySelector('[aria-label="Cantidad requerida en unidades"]').value)
      }))
      .filter(item => item.product && Number.isInteger(item.quantity) && item.quantity > 0)
    if (!selected.length) return { suppliers: [], eligible: [], lowest: null }
    const filterSupplier = $("comparison-supplier").value
    const selectedPaymentMethod = canonical($("comparison-payment-method").value)
    const suppliers = state.suppliers.filter(supplier => supplier.active && (!filterSupplier || supplier.id === filterSupplier))
      .map(supplier => {
        const items = selected.map(({ product, quantity }) => {
          const term = state.productTerms.find(candidate =>
            candidate.supplierId === supplier.id && Number(candidate.productId) === Number(product.id)
          )
          if (!term) return { product, missing: true }
          const purchaseQuantity = Math.max(Number(term.minimumQuantity), Math.ceil(quantity / Number(term.unitsPerPurchase)))
          return {
            product,
            quantity,
            term,
            purchaseQuantity,
            suppliedUnits: purchaseQuantity * Number(term.unitsPerPurchase),
            subtotal: purchaseQuantity * Number(term.unitCost)
          }
        })
        const baseTotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
        for (const item of items) {
          if (item.missing) continue
          const applicableRules = (Array.isArray(item.term.discountRules) ? item.term.discountRules : []).filter(rule =>
            Number(rule.minimumQuantity || 0) <= item.purchaseQuantity &&
            Number(rule.minimumAmount || 0) <= baseTotal &&
            (!String(rule.paymentMethod || "").trim() || canonical(rule.paymentMethod) === selectedPaymentMethod)
          )
          const maxIndividualDiscount = applicableRules.reduce((maximum, rule) => Math.max(maximum, Number(rule.percentage || 0)), 0)
          const appliedDiscount = supplier.discountApplication === "cumulative"
            ? 100 * (1 - applicableRules.reduce((remaining, rule) => remaining * (1 - Number(rule.percentage) / 100), 1))
            : maxIndividualDiscount
          item.maxIndividualDiscount = maxIndividualDiscount
          item.appliedDiscount = Math.min(100, appliedDiscount)
          item.discountAmount = item.subtotal * item.appliedDiscount / 100
          item.finalSubtotal = item.subtotal - item.discountAmount
        }
        const total = items.reduce((sum, item) => sum + Number(item.finalSubtotal || 0), 0)
        const missingCount = items.filter(item => item.missing).length
        const minimum = Number(supplier.minimumOrderAmount || 0)
        return { supplier, items, total, baseTotal, discountTotal: baseTotal - total, missingCount, minimum, meetsMinimum: baseTotal >= minimum }
      })
      .filter(entry => entry.items.length > 0)
      .sort((a, b) => {
        if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount
        return a.total - b.total || a.supplier.name.localeCompare(b.supplier.name, "es")
      })
    const eligible = suppliers.filter(entry => entry.missingCount === 0 && entry.meetsMinimum)
    const lowest = eligible.length ? Math.min(...eligible.map(entry => entry.total)) : null
    return { selected, suppliers, eligible, lowest }
  }

  function renderComparisonResults() {
    const { selected, suppliers, lowest } = getComparisonData()
    $("export-comparison").disabled = !selected || !selected.length || !suppliers.length
    if (!selected || !selected.length) {
      $("comparison-results").innerHTML = '<p class="text-sm text-slate-500">Selecciona al menos un producto y una cantidad para consultar sus proveedores.</p>'
      return
    }
    $("comparison-results").innerHTML = suppliers.length ? suppliers.map(entry => `
      <article class="rounded-xl border ${lowest != null && entry.missingCount === 0 && entry.total === lowest ? "border-emerald-400 bg-emerald-50" : "border-slate-200"} p-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div><h3 class="font-bold">${escapeHtml(entry.supplier.name)}${lowest != null && entry.missingCount === 0 && entry.total === lowest ? ' <span class="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Menor subtotal completo</span>' : ""}</h3>
          <p class="text-xs text-slate-600">${escapeHtml([entry.supplier.paymentTerms, entry.supplier.deliveryTerms].filter(Boolean).join(" · ") || "Sin condiciones registradas")}</p></div>
          <div class="text-right"><p class="font-bold">${entry.missingCount ? "Cobertura parcial" : `Final ${money(entry.total)}`}</p>
            <p class="text-xs text-slate-500">Antes del descuento ${money(entry.baseTotal)} · descuento ${money(entry.discountTotal)}</p>
            <p class="text-xs ${entry.meetsMinimum ? "text-slate-500" : "text-amber-700"}">Mínimo sobre subtotal antes de descuento ${money(entry.minimum)}${entry.meetsMinimum ? "" : " · no alcanzado"}</p></div>
        </div>
        <div class="mt-3 divide-y border-t">${entry.items.map(item => item.missing
          ? `<p class="py-2 text-sm text-rose-700">${escapeHtml(item.product.name)} · Sin precio registrado con este proveedor</p>`
          : `<p class="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>${escapeHtml(item.product.name)} · requerido ${item.quantity} · comprar ${item.purchaseQuantity} ${escapeHtml(item.term.purchaseUnit)} (${item.suppliedUnits} unid.) · ${money(item.term.unitCost)} / ${escapeHtml(item.term.purchaseUnit)}<span class="block text-xs text-slate-600">Base ${money(item.subtotal)} · máx. descuento individual ${item.maxIndividualDiscount.toFixed(2)}% · descuento aplicado ${item.appliedDiscount.toFixed(2)}% · final ${money(item.finalSubtotal)}</span><span class="block text-xs text-slate-500">Precio verificado ${item.term.priceVerifiedAt ? escapeHtml(new Date(item.term.priceVerifiedAt).toLocaleDateString("es")) : "sin fecha registrada"}</span></span><strong>${money(item.finalSubtotal)}</strong></p>`
        ).join("")}</div>
      </article>`).join("") : '<p class="text-sm text-slate-500">No hay proveedores activos para mostrar.</p>'
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function downloadXlsx(url, options, fallbackName) {
    const response = await fetchAdmin(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || `No se pudo exportar (HTTP ${response.status}).`)
    }
    const disposition = response.headers.get("Content-Disposition") || ""
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || fallbackName
    saveBlob(await response.blob(), filename)
  }

  async function exportComparison() {
    const { selected, suppliers, lowest } = getComparisonData()
    if (!selected || !selected.length || !suppliers.length) {
      showStatus("Selecciona productos y cantidades para preparar la exportación.", true)
      return
    }
    const headers = [
      "Proveedor", "Producto", "Código", "Cantidad solicitada", "Cantidad a comprar",
      "Presentación proveedor", "Unidades recibidas", "Precio por presentación (USD)",
      "Subtotal antes de descuento (USD)", "Máx. descuento individual (%)", "Descuento aplicado (%)",
      "Descuento aplicado (USD)", "Subtotal final producto (USD)", "Mínimo de compra proveedor (USD)",
      "Subtotal antes de descuento cumple mínimo", "Productos faltantes proveedor",
      "Subtotal final lista proveedor (USD)", "Forma/plazo de pago", "Método de pago evaluado",
      "Entrega/flete", "Precio verificado", "Menor subtotal final completo"
    ]
    const rows = [headers]
    for (const entry of suppliers) {
      for (const item of entry.items) {
        rows.push([
          entry.supplier.name,
          item.product.name || "Producto",
          item.product.code || "",
          item.missing ? "" : item.quantity,
          item.missing ? "" : item.purchaseQuantity,
          item.missing ? "" : item.term.purchaseUnit,
          item.missing ? "" : item.suppliedUnits,
          item.missing ? "" : Number(item.term.unitCost),
          item.missing ? "" : Number(item.subtotal),
          item.missing ? "" : Number(item.maxIndividualDiscount),
          item.missing ? "" : Number(item.appliedDiscount),
          item.missing ? "" : Number(item.discountAmount),
          item.missing ? "" : Number(item.finalSubtotal),
          Number(entry.minimum),
          entry.meetsMinimum ? "Sí" : "No",
          item.missing ? "Sí" : "No",
          entry.missingCount ? "" : Number(entry.total),
          entry.supplier.paymentTerms || "",
          entry.supplier.deliveryTerms || "",
          $("comparison-payment-method").value,
          item.missing || !item.term.priceVerifiedAt ? "" : new Date(item.term.priceVerifiedAt).toLocaleDateString("es"),
          lowest != null && entry.missingCount === 0 && entry.total === lowest ? "Sí" : "No"
        ])
      }
    }
    try {
      await downloadXlsx("/api/admin/procurement/export/comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.slice(1) })
      }, `comparativo-proveedores-${new Date().toISOString().slice(0, 10)}.xlsx`)
      showStatus(`Comparativo exportado como Excel: ${rows.length - 1} filas.`)
    } catch (error) {
      showStatus(error.message, true)
    }
  }

  async function saveSettings() {
    await request("/api/admin/procurement", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suppliers: state.suppliers, productTerms: state.productTerms })
    })
  }

  function renderOrders() {
    const labels = { draft: "Borrador", ordered: "Solicitada", received: "Recibida", cancelled: "Cancelada" }
    const query = $("orders-search").value.trim().toLocaleLowerCase("es")
    const status = $("orders-status-filter").value
    const orders = state.purchaseOrders.filter(order => {
      const haystack = `${order.id} ${order.supplierName} ${(order.items || []).map(item => item.productName).join(" ")}`.toLocaleLowerCase("es")
      return (!status || order.status === status) && (!query || haystack.includes(query))
    })
    $("orders-list").innerHTML = orders.length ? orders.map(order => {
      const canOrder = order.status === "draft"
      const canReceive = order.status === "ordered"
      const canCancel = ["draft", "ordered"].includes(order.status)
      const sourceOrderIds = order.sourceWholesaleOrderIds && order.sourceWholesaleOrderIds.length
        ? order.sourceWholesaleOrderIds
        : (order.sourceWholesaleOrderId ? [order.sourceWholesaleOrderId] : [])
      return `<article class="rounded-xl border border-slate-200 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold">${escapeHtml(order.id)} · ${escapeHtml(order.supplierName)}</h3><span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">${escapeHtml(labels[order.status] || order.status)}</span></div>
            <p class="mt-1 text-xs text-slate-500">Creada ${escapeHtml(new Date(order.createdAt).toLocaleString("es"))}${sourceOrderIds.length ? ` · Pedidos mayoristas ${sourceOrderIds.map(escapeHtml).join(", ")}` : ""}</p>
          </div><div class="text-right"><p class="text-lg font-bold">${money(order.total ?? Number(order.goodsSubtotal || 0) + Number(order.freightCost || 0))}</p><p class="text-xs text-slate-500">Mercancía ${money(order.goodsSubtotal ?? (order.items || []).reduce((sum, item) => sum + Number(item.subtotal || 0), 0))} · Flete ${money(order.freightCost)}</p></div>
        </div>
        <div class="mt-3 divide-y border-y">${(order.items || []).map(item => `<div class="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>${Number(item.quantity)} ${escapeHtml(item.purchaseUnit)} × ${escapeHtml(item.productName)} <span class="text-xs text-slate-500">(${Number(item.unitsPerPurchase)} unid. por compra)</span>${Number(item.freightAllocation || 0) > 0 ? `<span class="block text-xs text-sky-800">Flete asignado ${money(item.freightAllocation)} · costo puesto en almacén ${money(item.landedCostPerUnit || 0)} por unidad</span>` : ""}</span><span>${money(item.subtotal)}</span></div>`).join("")}</div>
        ${order.notes ? `<p class="mt-2 text-sm text-slate-600">${escapeHtml(order.notes)}</p>` : ""}
        <div class="mt-3 flex flex-wrap gap-2">
          ${canOrder ? `<button type="button" data-order-action="ordered" data-order-id="${escapeHtml(order.id)}" class="rounded bg-indigo-700 px-3 py-2 text-xs font-bold text-white">Marcar solicitada</button>` : ""}
          ${canReceive ? `<button type="button" data-order-action="received" data-order-id="${escapeHtml(order.id)}" class="rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Recibida · sumar al inventario</button>` : ""}
          ${canCancel ? `<button type="button" data-order-action="cancelled" data-order-id="${escapeHtml(order.id)}" class="rounded border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Cancelar</button>` : ""}
          ${order.status === "received" ? `<span class="self-center text-xs text-emerald-700">Entrada registrada en inventario el ${escapeHtml(new Date(order.receivedAt).toLocaleString("es"))}.</span>` : ""}
        </div>
      </article>`
    }).join("") : `<p class="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">${state.purchaseOrders.length ? "No hay órdenes que coincidan con los filtros." : "Todavía no hay órdenes de compra."}</p>`
  }

  function renderAll() {
    renderSummary()
    renderSelects()
    renderSuppliers()
    renderTermFilters()
    renderTerms()
    renderOrders()
    renderOrderItems()
    if (!$("comparison-items").children.length) $("comparison-items").appendChild(makeComparisonItem())
    renderComparisonResults()
    renderPriceListPreview()
    renderSupplierCatalogSearch()
  }

  function renderForecast() {
    const target = $("forecast-list")
    const forecast = state.forecast
    if (!forecast) {
      target.innerHTML = '<p class="text-sm text-slate-500">No se pudo cargar la previsión. Usa “Actualizar previsión” para intentarlo de nuevo.</p>'
      return
    }
    if (!forecast.demandOrderCount) {
      target.innerHTML = '<p class="rounded-lg border border-dashed p-5 text-sm text-slate-500">No hay pedidos mayoristas recibidos o en preparación para calcular demanda.</p>'
      return
    }
    const supplierCards = (forecast.suppliers || []).map(group => `
      <article class="rounded-xl border border-slate-200 p-4" data-forecast-group data-supplier-id="${escapeHtml(group.supplierId)}" data-minimum-order="${Number(group.minimumOrderAmount || 0)}" data-active="${group.active ? "true" : "false"}">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h3 class="font-bold">${escapeHtml(group.supplierName)}${group.active ? "" : ' <span class="text-xs text-rose-700">(inactivo)</span>'}</h3>
            <p class="text-xs text-slate-500">Mínimo de mercancía ${money(group.minimumOrderAmount)} · El flete se registra aparte</p></div>
          <div class="text-right text-sm"><p>Propuesta de mercancía: <strong data-forecast-goods>${money(group.suggestedTotal)}</strong></p><p>Flete: <input data-forecast-freight type="number" min="0" step="0.01" value="0" class="mt-1 w-28 rounded border px-2 py-1 text-right" aria-label="Flete para ${escapeHtml(group.supplierName)}"></p><p>Total borrador: <strong data-forecast-total>${money(group.suggestedTotal)}</strong></p></div>
        </div>
        <div class="mt-3 overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead><tr class="border-b text-xs uppercase text-slate-500"><th class="py-2">Producto</th><th>Paquetes pedidos</th><th>Unidades</th><th>Stock</th><th>Compra solicitada</th><th>Faltante</th><th>Cantidad de compra</th><th>Subtotal</th></tr></thead>
            <tbody>${group.products.map(item => `<tr class="border-b" data-forecast-line data-term-id="${escapeHtml(item.termId)}" data-unit-cost="${Number(item.unitCost)}" data-minimum="${Number(item.minimumQuantity)}" data-order-ids="${escapeHtml(JSON.stringify(item.orderIds))}">
              <td class="py-2"><p class="font-semibold">${escapeHtml(item.productName)}</p><p class="text-xs text-slate-500">${escapeHtml(item.productCode || "")} · ${Number(item.unitsPerPurchase)} unidades por ${escapeHtml(item.purchaseUnit)}</p></td>
              <td><p class="font-semibold">${Number(item.demandPackages)} paquetes · ${Number(item.demandUnitSales || 0)} unidades sueltas</p><p class="text-xs text-slate-500">${item.orders.map(order => [Number(order.packages) > 0 ? `${Number(order.packages)} ${order.packageNames.map(escapeHtml).join("/")}` : "", Number(order.units) > 0 ? `${Number(order.units)} unidad(es)` : ""].filter(Boolean).join(" + ")).join(" · ")}</p></td>
              <td>${Number(item.demandUnits)}</td><td>${Number(item.availableUnits)}</td><td>${Number(item.inboundUnits)}</td><td>${Number(item.shortageUnits)}</td>
              <td><input data-forecast-quantity type="number" min="0" step="1" value="${Number(item.suggestedQuantity)}" class="w-24 rounded border px-2 py-1" aria-label="Cantidad propuesta de ${escapeHtml(item.productName)}"></td><td data-forecast-subtotal>${money(item.suggestedSubtotal)}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2"><p data-forecast-message class="text-sm text-slate-600"></p><button type="button" data-create-forecast class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Crear borrador para revisar</button></div>
      </article>`).join("")
    const unassigned = (forecast.unassigned || []).length ? `
      <article class="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h3 class="font-bold text-amber-950">Productos sin proveedor principal</h3>
        <p class="mt-1 text-sm text-amber-900">Asigna un proveedor principal en “Costo y condiciones por producto” para incluirlos en una propuesta.</p>
        <ul class="mt-2 list-inside list-disc text-sm">${forecast.unassigned.map(item => `<li>${escapeHtml(item.productName)}: ${Number(item.demandPackages)} paquetes + ${Number(item.demandUnitSales || 0)} unidades puntuales (${Number(item.demandUnits)} unidades de inventario) · stock ${Number(item.availableUnits)} · pedidos ${item.orders.map(order => [Number(order.packages) > 0 ? `${Number(order.packages)} ${order.packageNames.map(escapeHtml).join("/")}` : "", Number(order.units) > 0 ? `${Number(order.units)} unidad(es)` : ""].filter(Boolean).join(" + ")).join(" · ")}</li>`).join("")}</ul>
      </article>` : ""
    target.innerHTML = `<p class="text-xs text-slate-500">${Number(forecast.demandOrderCount)} pedidos considerados. Las propuestas no se envían automáticamente al proveedor ni cambian el stock.</p>${supplierCards || '<p class="rounded-lg border border-dashed p-5 text-sm text-slate-500">No hay demanda vinculada a un proveedor principal.</p>'}${unassigned}`
    for (const group of target.querySelectorAll("[data-forecast-group]")) updateForecastGroup(group)
  }

  function updateForecastGroup(group) {
    const lines = Array.from(group.querySelectorAll("[data-forecast-line]"))
    let goods = 0
    let valid = lines.length > 0
    for (const line of lines) {
      const quantity = Number(line.querySelector("[data-forecast-quantity]").value)
      const minimum = Number(line.dataset.minimum)
      const unitCost = Number(line.dataset.unitCost)
      const subtotal = Number.isSafeInteger(quantity) && quantity > 0 ? quantity * unitCost : 0
      if (!Number.isSafeInteger(quantity) || quantity < 0 || (quantity > 0 && quantity < minimum)) valid = false
      line.querySelector("[data-forecast-subtotal]").textContent = money(subtotal)
      goods += subtotal
    }
    const freight = Number(group.querySelector("[data-forecast-freight]").value || 0)
    if (!Number.isFinite(freight) || freight < 0) valid = false
    const minimumOrder = Number(group.dataset.minimumOrder)
    group.querySelector("[data-forecast-goods]").textContent = money(goods)
    group.querySelector("[data-forecast-total]").textContent = money(goods + (Number.isFinite(freight) ? freight : 0))
    const button = group.querySelector("[data-create-forecast]")
    const message = group.querySelector("[data-forecast-message]")
    const active = group.dataset.active === "true"
    message.textContent = !active
      ? "Activa este proveedor para crear una propuesta."
      : goods === 0
        ? "No hay cantidades seleccionadas."
        : goods < minimumOrder
          ? `Faltan ${money(minimumOrder - goods)} para alcanzar el mínimo de mercancía.`
          : "La propuesta se guardará como borrador; todavía no se enviará al proveedor."
    button.disabled = !valid || !active || goods < minimumOrder || goods === 0
  }

  async function loadForecast() {
    try {
      state.forecast = await request("/api/admin/procurement/forecast")
      renderForecast()
    } catch (error) {
      state.forecast = null
      renderForecast()
      showStatus(`No se pudo cargar la previsión: ${error.message}`, true)
    }
  }

  function makeOrderItem() {
    const row = document.createElement("div")
    row.className = "grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
    row.dataset.orderItem = ""
    const select = document.createElement("select")
    select.className = "min-w-0 rounded-lg border bg-white px-3 py-2 text-sm"
    select.dataset.orderTerm = ""
    select.setAttribute("aria-label", "Producto y condición del proveedor")
    const quantity = document.createElement("input")
    quantity.type = "number"
    quantity.min = "1"
    quantity.step = "1"
    quantity.value = "1"
    quantity.className = "rounded-lg border px-3 py-2 text-sm"
    quantity.dataset.orderQuantity = ""
    quantity.setAttribute("aria-label", "Cantidad a comprar")
    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "rounded border border-rose-200 px-3 py-2 text-sm text-rose-700"
    remove.textContent = "Quitar"
    remove.addEventListener("click", () => { row.remove(); updateOrderTotal() })
    const details = document.createElement("p")
    details.className = "text-xs text-slate-500 md:col-span-3"
    details.dataset.orderDetails = ""
    row.append(select, quantity, remove, details)
    select.addEventListener("change", () => {
      const term = termById(select.value)
      if (term) quantity.value = String(term.minimumQuantity)
      updateOrderItem(row)
      updateOrderTotal()
    })
    quantity.addEventListener("input", () => { updateOrderItem(row); updateOrderTotal() })
    return row
  }

  function updateOrderItem(row) {
    const term = termById(row.querySelector("[data-order-term]").value)
    const details = row.querySelector("[data-order-details]")
    const quantity = row.querySelector("[data-order-quantity]")
    if (!term) {
      details.textContent = "Selecciona un producto con costo registrado para este proveedor."
      quantity.min = "1"
      return
    }
    quantity.min = String(term.minimumQuantity)
    const count = Number(quantity.value)
    const lineTotal = Number.isInteger(count) && count > 0 ? count * Number(term.unitCost) : 0
    details.textContent = `${term.minimumQuantity} ${term.purchaseUnit} mínimo · ${money(term.unitCost)} por ${term.purchaseUnit} · ${term.unitsPerPurchase} unidades de inventario por compra · Subtotal ${money(lineTotal)}`
  }

  function renderOrderItems() {
    const supplierId = $("order-supplier").value
    const terms = state.productTerms.filter(term => term.supplierId === supplierId)
    for (const row of $("order-items").querySelectorAll("[data-order-item]")) {
      const select = row.querySelector("[data-order-term]")
      const previous = select.value
      select.innerHTML = `<option value="">Selecciona producto…</option>${terms.map(term => {
        const product = productById(term.productId) || {}
        return `<option value="${escapeHtml(term.id)}">${escapeHtml(product.name || "Producto")} · ${money(term.unitCost)} / ${escapeHtml(term.purchaseUnit)}</option>`
      }).join("")}`
      if (terms.some(term => term.id === previous)) select.value = previous
      updateOrderItem(row)
    }
    updateOrderTotal()
  }

  function populateFromWholesaleOrder() {
    const source = state.wholesaleOrders.find(order => order.id === $("source-order").value)
    if (!source) {
      $("source-order-hint").classList.add("hidden")
      $("order-items").replaceChildren(makeOrderItem())
      renderOrderItems()
      return
    }
    const supplierId = $("order-supplier").value
    if (!supplierId) {
      $("source-order-hint").textContent = "Selecciona primero el proveedor para cargar los productos de este pedido mayorista."
      $("source-order-hint").classList.remove("hidden")
      $("order-items").replaceChildren()
      renderOrderItems()
      return
    }
    const terms = state.productTerms.filter(term => term.supplierId === supplierId)
    const missing = []
    const rows = []
    const sourceItems = new Map()
    for (const item of source.items || []) {
      const requiredUnits = Number(item.unitsTotal) || Number(item.qty || 0) * (item.saleUnit === "unit" ? 1 : Number(item.unitsPerPackage || 1))
      const grouped = sourceItems.get(Number(item.productId)) || { ...item, requiredUnits: 0 }
      grouped.requiredUnits += requiredUnits
      sourceItems.set(Number(item.productId), grouped)
    }
    for (const item of sourceItems.values()) {
      const term = terms.find(candidate => Number(candidate.productId) === Number(item.productId))
      if (!term) {
        missing.push(item.name)
        continue
      }
      const purchaseQuantity = Math.max(term.minimumQuantity, Math.ceil(item.requiredUnits / term.unitsPerPurchase))
      const row = makeOrderItem()
      $("order-items").appendChild(row)
      renderOrderItems()
      row.querySelector("[data-order-term]").value = term.id
      row.querySelector("[data-order-quantity]").value = String(purchaseQuantity)
      updateOrderItem(row)
      rows.push(row)
    }
    if (!rows.length) $("order-items").appendChild(makeOrderItem())
    $("source-order-hint").textContent = missing.length
      ? `No hay costo configurado para este proveedor en: ${missing.join(", ")}. Agrega el costo o elige otro proveedor; los demás productos se cargaron para revisión.`
      : "Cantidades precargadas según el pedido mayorista y el empaque del proveedor. Revisa y ajusta antes de guardar."
    $("source-order-hint").classList.remove("hidden")
    updateOrderTotal()
  }

  function updateOrderTotal() {
    const supplier = supplierById($("order-supplier").value)
    const rows = Array.from($("order-items").querySelectorAll("[data-order-item]"))
    const goodsSubtotal = rows.reduce((sum, row) => {
      const term = termById(row.querySelector("[data-order-term]").value)
      const quantity = Number(row.querySelector("[data-order-quantity]").value)
      return term && Number.isInteger(quantity) && quantity > 0 ? sum + quantity * Number(term.unitCost) : sum
    }, 0)
    const minimum = Number(supplier && supplier.minimumOrderAmount || 0)
    const freightCost = Number($("order-freight").value || 0)
    const total = goodsSubtotal + (Number.isFinite(freightCost) && freightCost > 0 ? freightCost : 0)
    const itemsValid = rows.length > 0 && rows.every(row => {
      const term = termById(row.querySelector("[data-order-term]").value)
      const quantity = Number(row.querySelector("[data-order-quantity]").value)
      return term && Number.isInteger(quantity) && quantity >= term.minimumQuantity
    })
    $("order-total").textContent = `Mercancía: ${money(goodsSubtotal)} · Flete: ${money(freightCost)} · Total: ${money(total)} · Mínimo mercancía: ${money(minimum)}${goodsSubtotal < minimum ? " · Falta completar el mínimo" : ""}`
    $("create-order").disabled = !Number.isFinite(freightCost) || freightCost < 0 || goodsSubtotal < minimum || !$("order-supplier").value || !itemsValid
  }

  async function load() {
    const data = await request("/api/admin/procurement")
    state.dispatchCosts = await request("/api/admin/wholesale/dispatch-costs")
    for (const key of ["suppliers", "productTerms", "supplierCatalogItems", "purchaseOrders", "catalog", "wholesaleOrders"]) {
      state[key] = Array.isArray(data[key]) ? data[key] : []
    }
    renderAll()
    await loadForecast()
  }

  $("supplier-form").addEventListener("submit", async event => {
    event.preventDefault()
    const id = $("supplier-id").value || `SUP-${Date.now()}`
    const supplier = {
      id,
      name: $("supplier-name").value.trim(),
      contact: $("supplier-contact").value.trim(),
      phone: $("supplier-phone").value.trim(),
      email: $("supplier-email").value.trim(),
      minimumOrderAmount: Number($("supplier-minimum").value),
      paymentTerms: $("supplier-payment-terms").value.trim(),
      deliveryTerms: $("supplier-delivery-terms").value.trim(),
      discountApplication: $("supplier-discount-application").value,
      active: $("supplier-active").checked
    }
    const index = state.suppliers.findIndex(item => item.id === id)
    if (index >= 0) state.suppliers[index] = { ...state.suppliers[index], ...supplier }
    else state.suppliers.push(supplier)
    try {
      await saveSettings()
      clearSupplierForm()
      await load()
      showStatus("Proveedor guardado.")
    } catch (error) {
      showStatus(error.message, true)
    }
  })

  $("supplier-clear").addEventListener("click", clearSupplierForm)
  $("suppliers-list").addEventListener("click", async event => {
    const exportButton = event.target.closest("[data-export-supplier]")
    if (exportButton) {
      exportButton.disabled = true
      try {
        await downloadXlsx(`/api/admin/procurement/suppliers/${encodeURIComponent(exportButton.dataset.exportSupplier)}/export`, {}, "lista-proveedor.xlsx")
        showStatus("Lista del proveedor exportada como archivo Excel.")
      } catch (error) {
        showStatus(error.message, true)
      } finally {
        exportButton.disabled = false
      }
      return
    }
    const button = event.target.closest("[data-edit-supplier]")
    if (!button) return
    const supplier = supplierById(button.dataset.editSupplier)
    if (!supplier) return
    $("supplier-id").value = supplier.id
    $("supplier-name").value = supplier.name
    $("supplier-contact").value = supplier.contact || ""
    $("supplier-phone").value = supplier.phone || ""
    $("supplier-email").value = supplier.email || ""
    $("supplier-minimum").value = supplier.minimumOrderAmount
    $("supplier-payment-terms").value = supplier.paymentTerms || ""
    $("supplier-delivery-terms").value = supplier.deliveryTerms || ""
    $("supplier-discount-application").value = supplier.discountApplication === "cumulative" ? "cumulative" : "best"
    $("supplier-active").checked = supplier.active
    $("supplier-name").focus()
  })

  $("preview-price-list").addEventListener("click", async () => {
    try {
      await preparePriceList()
      showStatus("Vista previa preparada. Verifica los productos y costos antes de confirmar.")
    } catch (error) {
      showStatus(error.message, true)
    }
  })
  $("price-list-preview").addEventListener("change", event => {
    const input = event.target.closest("[data-import-product]")
    if (input && state.priceListPreview) {
      const row = state.priceListPreview.rows[Number(input.dataset.importProduct)]
      if (!row) return
      const product = resolveImportProduct(input.value, state.priceListPreview.supplierId)
      row.productId = product ? Number(product.id) : null
      row.external = !product
      row.productChoice = input.value
      renderPriceListPreview()
      return
    }
    const externalCheckbox = event.target.closest("[data-import-external]")
    if (externalCheckbox && state.priceListPreview) {
      const row = state.priceListPreview.rows[Number(externalCheckbox.dataset.importExternal)]
      if (row) row.external = externalCheckbox.checked
      renderPriceListPreview()
      return
    }
    const field = event.target.closest("[data-import-field]")
    if (!field || !state.priceListPreview) return
    const row = state.priceListPreview.rows[Number(field.dataset.importIndex)]
    if (!row) return
    const key = field.dataset.importField
    row[key] = ["unitCost", "unitsPerPurchase", "minimumQuantity", "discountMinimumQuantity", "discountMinimumAmount", "discountPercentage"].includes(key)
      ? parseListNumber(field.value, NaN)
      : field.value.trim()
    renderPriceListPreview()
  })
  $("price-list-preview").addEventListener("click", async event => {
    const pageButton = event.target.closest("[data-import-page]")
    if (pageButton) {
      state.priceListPage = Number(pageButton.dataset.importPage)
      renderPriceListPreview()
      return
    }
    if (!event.target.closest("#apply-price-list")) return
    const button = event.target.closest("#apply-price-list")
    button.disabled = true
    try {
      await applyPriceList()
    } catch (error) {
      showStatus(error.message, true)
      button.disabled = false
    }
  })
  $("add-comparison-item").addEventListener("click", () => {
    const row = makeComparisonItem()
    $("comparison-items").appendChild(row)
    row.querySelector('input[type="search"]').focus()
    renderComparisonResults()
  })
  $("comparison-items").addEventListener("click", event => {
    const option = event.target.closest("[data-select-comparison-product]")
    if (!option) return
    const row = option.closest("[data-comparison-item]")
    const product = productById(option.dataset.selectComparisonProduct)
    if (!row || !product) return
    row.dataset.productId = String(product.id)
    row.querySelector('input[type="search"]').value = `${product.name || "Producto"}${product.code ? ` · ${product.code}` : ""}`
    row.querySelector("[data-product-suggestions]").classList.add("hidden")
    renderComparisonResults()
  })
  $("export-comparison").addEventListener("click", exportComparison)
  $("comparison-supplier").addEventListener("change", renderComparisonResults)
  $("comparison-category").addEventListener("change", () => {
    for (const row of $("comparison-items").querySelectorAll("[data-comparison-item]")) {
      const search = row.querySelector('input[type="search"]')
      if (search.value.trim() && !row.dataset.productId) search.dispatchEvent(new Event("input"))
    }
    renderComparisonResults()
  })
  $("comparison-payment-method").addEventListener("change", renderComparisonResults)
  $("extract-pdf-batch").addEventListener("click", async () => {
    try {
      await extractPdfBatch()
      if (state.priceListPreview && state.priceListPreview.complete) {
        showStatus(`Extracción local completa: ${state.priceListPreview.rows.length} renglones detectados. Revisa antes de confirmar.`)
      }
    } catch (error) {
      showStatus(error.message, true)
      $("extract-pdf-batch").disabled = false
    }
  })
  $("discard-price-list").addEventListener("click", async () => {
    await discardPdfDocument()
    state.priceListPreview = null
    $("price-list-file").value = ""
    $("pdf-batch-controls").classList.add("hidden")
    $("pdf-batch-controls").classList.remove("flex")
    renderPriceListPreview()
    showStatus("Carga descartada. La lista vigente no fue modificada.")
  })

  $("order-supplier").addEventListener("change", () => {
    if ($("source-order").value) populateFromWholesaleOrder()
    else {
      $("order-items").replaceChildren(makeOrderItem())
      renderOrderItems()
    }
  })
  $("source-order").addEventListener("change", populateFromWholesaleOrder)
  $("order-freight").addEventListener("input", updateOrderTotal)
  $("add-order-item").addEventListener("click", () => {
    $("order-items").appendChild(makeOrderItem())
    renderOrderItems()
  })

  $("purchase-form").addEventListener("submit", async event => {
    event.preventDefault()
    const items = Array.from($("order-items").querySelectorAll("[data-order-item]"), row => ({
      termId: row.querySelector("[data-order-term]").value,
      quantity: Number(row.querySelector("[data-order-quantity]").value)
    }))
    try {
      await request("/api/admin/procurement/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: $("order-supplier").value,
          sourceWholesaleOrderId: $("source-order").value,
          freightCost: Number($("order-freight").value || 0),
          notes: $("order-notes").value.trim(),
          items
        })
      })
      $("order-notes").value = ""
      $("order-freight").value = "0"
      $("order-items").replaceChildren(makeOrderItem())
      $("source-order").value = ""
      $("source-order-hint").classList.add("hidden")
      renderOrderItems()
      await load()
      showStatus("Orden guardada como borrador. Todavía no se ha enviado al proveedor.")
    } catch (error) {
      showStatus(error.message, true)
    }
  })

  $("orders-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-order-action]")
    if (!button) return
    const action = button.dataset.orderAction
    const promptText = action === "received"
      ? "Al confirmar, las cantidades se sumarán al inventario operativo y al stock de Gestión de productos. ¿Ya recibiste toda la orden?"
      : action === "cancelled" ? "¿Cancelar esta orden de compra?" : "¿Marcar esta orden como solicitada al proveedor?"
    if (!confirm(promptText)) return
    button.disabled = true
    try {
      await request(`/api/admin/procurement/orders/${encodeURIComponent(button.dataset.orderId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action })
      })
      await load()
      showStatus(action === "received" ? "Recepción registrada en el inventario operativo y en el stock de Gestión de productos." : "Estado de la orden actualizado.")
    } catch (error) {
      showStatus(error.message, true)
      button.disabled = false
    }
  })

  $("forecast-list").addEventListener("input", event => {
    const group = event.target.closest("[data-forecast-group]")
    if (group) updateForecastGroup(group)
  })
  $("terms-search").addEventListener("input", renderTerms)
  $("terms-category").addEventListener("change", renderTerms)
  $("terms-supplier").addEventListener("change", renderTerms)
  $("supplier-catalog-search").addEventListener("input", renderSupplierCatalogSearch)
  $("supplier-catalog-filter").addEventListener("change", renderSupplierCatalogSearch)
  $("orders-search").addEventListener("input", renderOrders)
  $("orders-status-filter").addEventListener("change", renderOrders)
  $("forecast-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-create-forecast]")
    if (!button) return
    const group = button.closest("[data-forecast-group]")
    const lines = Array.from(group.querySelectorAll("[data-forecast-line]"))
    let items
    try {
      items = lines.map(line => ({
        termId: line.dataset.termId,
        quantity: Number(line.querySelector("[data-forecast-quantity]").value),
        orderIds: JSON.parse(line.dataset.orderIds || "[]")
      })).filter(item => item.quantity > 0)
    } catch (error) {
      showStatus(`No se pudo preparar la propuesta: ${error.message}`, true)
      return
    }
    if (!items.length) return
    if (!confirm("Se creará un borrador de compra para revisar. No se enviará al proveedor. ¿Continuar?")) return
    button.disabled = true
    try {
      const sourceWholesaleOrderIds = [...new Set(items.flatMap(item => item.orderIds))]
      await request("/api/admin/procurement/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: group.dataset.supplierId,
          sourceWholesaleOrderIds,
          freightCost: Number(group.querySelector("[data-forecast-freight]").value || 0),
          notes: `Borrador desde previsión agrupada de pedidos mayoristas: ${sourceWholesaleOrderIds.join(", ")}`,
          items: items.map(({ termId, quantity }) => ({ termId, quantity }))
        })
      })
      await load()
      showStatus("Borrador de compra creado y vinculado a los pedidos mayoristas incluidos. Revisa y marca como solicitada cuando corresponda.")
    } catch (error) {
      showStatus(error.message, true)
      button.disabled = false
    }
  })

  $("refresh").addEventListener("click", () => load().catch(error => showStatus(error.message, true)))
  $("refresh-forecast").addEventListener("click", loadForecast)
  $("order-items").appendChild(makeOrderItem())
  load().catch(error => showStatus(`No se pudo cargar Gestión de compras: ${error.message}`, true))
})()
