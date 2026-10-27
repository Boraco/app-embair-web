(() => {
  const $ = id => document.getElementById(id)
  const state = { suppliers: [], productTerms: [], purchaseOrders: [], catalog: [], wholesaleOrders: [], forecast: null, dispatchCosts: null }
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
        multiple_preferred_suppliers_for_product: "Solo puede haber un proveedor principal por producto."
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
    const currentTermSupplier = $("term-supplier").value
    const currentOrderSupplier = $("order-supplier").value
    $("term-supplier").innerHTML = `<option value="">Selecciona proveedor…</option>${supplierOptions}`
    $("order-supplier").innerHTML = `<option value="">Selecciona proveedor…</option>${supplierOptions}`
    if (activeSuppliers.some(supplier => supplier.id === currentTermSupplier)) $("term-supplier").value = currentTermSupplier
    if (activeSuppliers.some(supplier => supplier.id === currentOrderSupplier)) $("order-supplier").value = currentOrderSupplier

    const currentProduct = $("term-product").value
    const catalogOptions = state.catalog.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map(product => `<option value="${Number(product.id)}">${escapeHtml(product.name)}${product.code ? ` · ${escapeHtml(product.code)}` : ""}</option>`).join("")
    $("term-product").innerHTML = `<option value="">Selecciona producto…</option>${catalogOptions}`
    if (state.catalog.some(product => String(product.id) === currentProduct)) $("term-product").value = currentProduct

    const currentSource = $("source-order").value
    $("source-order").innerHTML = `<option value="">Sin pedido asociado</option>${state.wholesaleOrders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.id)} · ${escapeHtml(order.clientName)}</option>`).join("")}`
    if (state.wholesaleOrders.some(order => order.id === currentSource)) $("source-order").value = currentSource
  }

  function clearSupplierForm() {
    $("supplier-form").reset()
    $("supplier-id").value = ""
    $("supplier-minimum").value = "0"
    $("supplier-active").checked = true
  }

  function renderSuppliers() {
    $("suppliers-list").innerHTML = state.suppliers.length ? state.suppliers.map(supplier => `
      <div class="flex flex-wrap items-center justify-between gap-2 py-3">
        <div><p class="font-semibold">${escapeHtml(supplier.name)} ${supplier.active ? "" : '<span class="text-xs text-slate-400">(inactivo)</span>'}</p>
          <p class="text-xs text-slate-500">${escapeHtml([supplier.contact, supplier.phone, supplier.email].filter(Boolean).join(" · ") || "Sin contacto")} · Mínimo ${money(supplier.minimumOrderAmount)}</p></div>
        <button type="button" data-edit-supplier="${escapeHtml(supplier.id)}" class="rounded border px-3 py-1.5 text-xs font-semibold">Editar</button>
      </div>`).join("") : '<p class="py-4 text-sm text-slate-500">Todavía no hay proveedores registrados.</p>'
  }

  function renderTerms() {
    $("terms-list").innerHTML = state.productTerms.length ? state.productTerms.map(term => {
      const product = productById(term.productId) || {}
      const supplier = supplierById(term.supplierId) || {}
      const baseUnitCost = Number(term.unitCost) / Math.max(1, Number(term.unitsPerPurchase))
      const receivedUnitCost = getReceivedLandedCost(term.productId, term.supplierId)
      const marginCost = receivedUnitCost == null ? baseUnitCost : receivedUnitCost
      const salePrice = Number(product.price)
      const hasSalePrice = product.price != null && Number.isFinite(salePrice)
      const margin = hasSalePrice ? salePrice - marginCost : null
      return `<tr class="border-b">
        <td class="py-3"><p class="font-semibold">${escapeHtml(product.name || "Producto")}${term.preferredSupplier ? ' <span class="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">Principal</span>' : ""}</p><p class="text-xs text-slate-500">${escapeHtml(supplier.name || "Proveedor")} · ${escapeHtml(term.supplierSku || "Sin código proveedor")}</p></td>
        <td>${money(term.unitCost)} / ${escapeHtml(term.purchaseUnit)}</td>
        <td>${money(baseUnitCost)}</td>
        <td>${receivedUnitCost == null ? '<span class="text-xs text-slate-500">Sin recepción</span>' : `${money(receivedUnitCost)}${margin == null ? "" : `<span class="block text-xs ${margin >= 0 ? "text-emerald-700" : "text-rose-700"}">Margen vs. venta: ${money(margin)}</span>`}`}</td>
        <td>${Number(term.minimumQuantity)} ${escapeHtml(term.purchaseUnit)}${Number(term.unitsPerPurchase) > 1 ? `<span class="block text-xs text-slate-500">× ${Number(term.unitsPerPurchase)} unidades</span>` : ""}</td>
        <td class="text-right"><button type="button" data-edit-term="${escapeHtml(term.id)}" class="rounded border px-2 py-1 text-xs">Editar</button><button type="button" data-delete-term="${escapeHtml(term.id)}" class="ml-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700">Quitar</button></td>
      </tr>`
    }).join("") : '<tr><td colspan="6" class="py-4 text-sm text-slate-500">Agrega condiciones para comenzar a registrar costos privados.</td></tr>'
  }

  function clearTermForm() {
    $("term-form").reset()
    $("term-id").value = ""
    $("term-unit").value = "empaque"
    $("term-units").value = "1"
    $("term-minimum").value = "1"
    $("term-preferred").checked = false
    renderSelects()
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
    $("orders-list").innerHTML = state.purchaseOrders.length ? state.purchaseOrders.map(order => {
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
    }).join("") : '<p class="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">Todavía no hay órdenes de compra.</p>'
  }

  function renderAll() {
    renderSummary()
    renderSelects()
    renderSuppliers()
    renderTerms()
    renderOrders()
    renderOrderItems()
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
    for (const key of ["suppliers", "productTerms", "purchaseOrders", "catalog", "wholesaleOrders"]) {
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
      active: $("supplier-active").checked
    }
    const index = state.suppliers.findIndex(item => item.id === id)
    if (index >= 0) state.suppliers[index] = supplier
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
  $("suppliers-list").addEventListener("click", event => {
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
    $("supplier-active").checked = supplier.active
    $("supplier-name").focus()
  })

  $("term-form").addEventListener("submit", async event => {
    event.preventDefault()
    const term = {
      id: $("term-id").value || `TERM-${Date.now()}`,
      supplierId: $("term-supplier").value,
      productId: Number($("term-product").value),
      supplierSku: $("term-sku").value.trim(),
      unitCost: Number($("term-cost").value),
      purchaseUnit: $("term-unit").value.trim(),
      unitsPerPurchase: Number($("term-units").value),
      minimumQuantity: Number($("term-minimum").value),
      preferredSupplier: $("term-preferred").checked
    }
    const existing = termById(term.id)
    if (!term.preferredSupplier && !state.productTerms.some(item => item.preferredSupplier && Number(item.productId) === term.productId && item.id !== term.id) && !existing?.preferredSupplier) {
      term.preferredSupplier = true
    }
    if (term.preferredSupplier) {
      state.productTerms = state.productTerms.map(item => Number(item.productId) === term.productId ? { ...item, preferredSupplier: false } : item)
    }
    const conflict = state.productTerms.find(item => item.supplierId === term.supplierId && item.productId === term.productId && item.id !== term.id)
    if (conflict) {
      conflict.supplierSku = term.supplierSku
      conflict.unitCost = term.unitCost
      conflict.purchaseUnit = term.purchaseUnit
      conflict.unitsPerPurchase = term.unitsPerPurchase
      conflict.minimumQuantity = term.minimumQuantity
      conflict.preferredSupplier = term.preferredSupplier
    } else {
      const index = state.productTerms.findIndex(item => item.id === term.id)
      if (index >= 0) state.productTerms[index] = term
      else state.productTerms.push(term)
    }
    try {
      await saveSettings()
      clearTermForm()
      await load()
      showStatus("Costo y condiciones guardados de forma privada.")
    } catch (error) {
      showStatus(error.message, true)
    }
  })

  $("term-clear").addEventListener("click", clearTermForm)
  $("term-product").addEventListener("change", () => {
    const productId = Number($("term-product").value)
    const editingId = $("term-id").value
    const primary = state.productTerms.find(term => Number(term.productId) === productId && term.preferredSupplier && term.id !== editingId)
    $("term-preferred").checked = !primary
  })
  $("terms-list").addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-term]")
    if (edit) {
      const term = termById(edit.dataset.editTerm)
      if (!term) return
      $("term-id").value = term.id
      $("term-supplier").value = term.supplierId
      $("term-product").value = String(term.productId)
      $("term-sku").value = term.supplierSku || ""
      $("term-cost").value = term.unitCost
      $("term-unit").value = term.purchaseUnit
      $("term-units").value = term.unitsPerPurchase
      $("term-minimum").value = term.minimumQuantity
      $("term-preferred").checked = term.preferredSupplier === true
      $("term-supplier").focus()
      return
    }
    const remove = event.target.closest("[data-delete-term]")
    if (!remove || !confirm("¿Quitar este costo y condición del proveedor? Las órdenes existentes conservarán su costo guardado.")) return
    state.productTerms = state.productTerms.filter(term => term.id !== remove.dataset.deleteTerm)
    try {
      await saveSettings()
      await load()
      showStatus("Condición de compra quitada. Las órdenes existentes no se modificaron.")
    } catch (error) {
      showStatus(error.message, true)
    }
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
      ? "Al confirmar, las cantidades de esta orden se sumarán al inventario. ¿Ya recibiste toda la orden?"
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
      showStatus(action === "received" ? "Recepción registrada y sumada al inventario." : "Estado de la orden actualizado.")
    } catch (error) {
      showStatus(error.message, true)
      button.disabled = false
    }
  })

  $("forecast-list").addEventListener("input", event => {
    const group = event.target.closest("[data-forecast-group]")
    if (group) updateForecastGroup(group)
  })
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
