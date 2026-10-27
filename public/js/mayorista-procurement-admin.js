(() => {
  const modal = document.getElementById("procurement-product-modal")
  const form = document.getElementById("procurement-product-form")
  if (!modal || !form) return

  const $ = id => document.getElementById(id)
  let suppliers = []
  let productTerms = []
  let activeProductId = null
  let returnFocus = null

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character])
  const money = value => `US$ ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const supplierById = id => suppliers.find(supplier => supplier.id === id)

  function showStatus(message, isError = false) {
    const box = $("procurement-product-status")
    box.textContent = message
    box.className = `rounded-lg border px-3 py-2 text-sm ${isError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`
    box.classList.remove("hidden")
  }

  async function request(url, options = {}) {
    const token = (() => {
      try { return localStorage.getItem("admin_token") || "" } catch { return "" }
    })()
    const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Basic ${token}` } : {}) }
    let response = await fetch(url, { ...options, headers })
    if (response.status === 401 || response.status === 403) {
      const credentials = prompt("Credenciales administrativas (usuario:clave):")
      if (credentials) {
        const encoded = btoa(credentials)
        try { localStorage.setItem("admin_token", encoded) } catch {}
        response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Basic ${encoded}` } })
      }
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`)
    return result
  }

  function renderSupplierOptions(selectedId = "") {
    const activeSuppliers = suppliers.filter(supplier => supplier.active)
    const selectedSupplier = supplierById(selectedId)
    const availableSuppliers = selectedSupplier && !selectedSupplier.active
      ? [...activeSuppliers, selectedSupplier]
      : activeSuppliers
    $("procurement-supplier").innerHTML = `<option value="">Selecciona proveedor...</option>${availableSuppliers
      .map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}${supplier.active ? "" : " (inactivo)"}</option>`).join("")}`
    if (availableSuppliers.some(supplier => supplier.id === selectedId)) $("procurement-supplier").value = selectedId
  }

  function renderTerms() {
    const terms = productTerms.filter(term => Number(term.productId) === activeProductId)
    $("procurement-product-terms").innerHTML = terms.length ? terms.map(term => {
      const supplier = supplierById(term.supplierId)
      const baseCost = Number(term.unitCost) / Math.max(1, Number(term.unitsPerPurchase))
      return `<article class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
        <div class="min-w-0">
          <p class="font-semibold">${escapeHtml(supplier?.name || "Proveedor no disponible")}${term.preferredSupplier ? ' <span class="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">Principal</span>' : ""}</p>
          <p class="text-sm text-slate-700">${money(term.unitCost)} por ${escapeHtml(term.purchaseUnit)} · ${Number(term.unitsPerPurchase)} unidad(es) de inventario · costo base ${money(baseCost)}</p>
          <p class="text-xs text-slate-500">Mínimo: ${Number(term.minimumQuantity)} ${escapeHtml(term.purchaseUnit)}${term.supplierSku ? ` · Código proveedor: ${escapeHtml(term.supplierSku)}` : ""}${supplier?.active === false ? " · Proveedor inactivo" : ""}</p>
        </div>
        <div class="flex shrink-0 gap-2">
          <button type="button" data-edit-procurement-term="${escapeHtml(term.id)}" class="rounded border px-3 py-1.5 text-xs font-semibold">Editar</button>
          <button type="button" data-remove-procurement-term="${escapeHtml(term.id)}" class="rounded border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700">Quitar</button>
        </div>
      </article>`
    }).join("") : '<p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Este producto aún no tiene condiciones de compra. Agrega un proveedor abajo.</p>'
  }

  function resetForm(selectedSupplierId = "") {
    form.reset()
    $("procurement-product-id").value = String(activeProductId || "")
    $("procurement-term-id").value = ""
    $("procurement-units").value = "1"
    $("procurement-minimum").value = "1"
    renderSupplierOptions(selectedSupplierId || suppliers.find(supplier => supplier.active)?.id || "")
    const selectedSupplier = $("procurement-supplier").value
    const existing = productTerms.find(term => Number(term.productId) === activeProductId && term.supplierId === selectedSupplier)
    if (existing) populateForm(existing)
    else $("procurement-preferred").checked = !productTerms.some(term => Number(term.productId) === activeProductId && term.preferredSupplier)
  }

  function populateForm(term) {
    $("procurement-term-id").value = term.id
    $("procurement-supplier").value = term.supplierId
    $("procurement-sku").value = term.supplierSku || ""
    $("procurement-cost").value = term.unitCost
    $("procurement-unit").value = term.purchaseUnit
    $("procurement-units").value = term.unitsPerPurchase
    $("procurement-minimum").value = term.minimumQuantity
    $("procurement-preferred").checked = term.preferredSupplier === true
  }

  function openModal(productId, button) {
    activeProductId = Number(productId)
    returnFocus = button
    const row = Array.from(document.querySelectorAll("#products [data-product]"))
      .find(element => Number(element.dataset.product) === activeProductId)
    const productName = row?.querySelector("td .font-semibold")?.textContent?.trim() || "Producto"
    $("procurement-product-id").value = String(activeProductId)
    $("procurement-product-title").textContent = `Compras y proveedores · ${productName}`
    $("procurement-product-status").classList.add("hidden")
    $("procurement-product-terms").innerHTML = '<p class="text-sm text-slate-500">Cargando condiciones...</p>'
    form.querySelectorAll("input, select, button").forEach(control => { control.disabled = true })
    modal.classList.remove("hidden")
    modal.classList.add("flex")
    modal.setAttribute("aria-hidden", "false")

    request("/api/admin/procurement")
      .then(data => {
        suppliers = Array.isArray(data.suppliers) ? data.suppliers : []
        productTerms = Array.isArray(data.productTerms) ? data.productTerms : []
        renderTerms()
        resetForm()
        form.querySelectorAll("input, select, button").forEach(control => { control.disabled = false })
        $("procurement-supplier").focus()
        if (!suppliers.some(supplier => supplier.active)) {
          showStatus("Primero registra y activa un proveedor en Gestión de compras.", true)
        }
      })
      .catch(error => {
        $("procurement-product-terms").replaceChildren()
        form.querySelectorAll("input, select, button").forEach(control => { control.disabled = true })
        showStatus(`No se pudieron cargar las condiciones de compra: ${error.message}`, true)
      })
  }

  function closeModal() {
    modal.classList.add("hidden")
    modal.classList.remove("flex")
    modal.setAttribute("aria-hidden", "true")
    returnFocus?.focus()
  }

  document.getElementById("products")?.addEventListener("click", event => {
    const button = event.target.closest("[data-procurement-open]")
    if (button) openModal(button.dataset.procurementOpen, button)
  })

  modal.querySelectorAll("[data-procurement-close]").forEach(button => button.addEventListener("click", closeModal))
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal()
  })
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeModal()
  })

  $("procurement-supplier").addEventListener("change", () => {
    const term = productTerms.find(item => Number(item.productId) === activeProductId && item.supplierId === $("procurement-supplier").value)
    if (term) populateForm(term)
    else {
      const selectedSupplierId = $("procurement-supplier").value
      form.reset()
      $("procurement-product-id").value = String(activeProductId || "")
      $("procurement-units").value = "1"
      $("procurement-minimum").value = "1"
      renderSupplierOptions(selectedSupplierId)
      $("procurement-preferred").checked = !productTerms.some(item => Number(item.productId) === activeProductId && item.preferredSupplier)
    }
  })

  $("procurement-clear").addEventListener("click", () => resetForm($("procurement-supplier").value))

  form.addEventListener("submit", async event => {
    event.preventDefault()
    if (!form.reportValidity()) return
    const productId = Number($("procurement-product-id").value)
    const supplierId = $("procurement-supplier").value
    const existingId = $("procurement-term-id").value
    const duplicate = productTerms.find(term =>
      Number(term.productId) === productId &&
      term.supplierId === supplierId &&
      term.id !== existingId
    )
    if (duplicate) {
      showStatus("Ya existe una condición para este proveedor y producto. Selecciona Editar en esa condición.", true)
      return
    }

    const currentTerm = productTerms.find(term => term.id === existingId)
    const primaryExists = productTerms.some(term =>
      Number(term.productId) === productId && term.preferredSupplier && term.id !== existingId
    )
    const term = {
      id: existingId || `TERM-${Date.now()}`,
      supplierId,
      productId,
      supplierSku: $("procurement-sku").value.trim(),
      unitCost: Number($("procurement-cost").value),
      purchaseUnit: $("procurement-unit").value.trim(),
      unitsPerPurchase: Number($("procurement-units").value),
      minimumQuantity: Number($("procurement-minimum").value),
      preferredSupplier: $("procurement-preferred").checked || (!primaryExists && !currentTerm?.preferredSupplier)
    }
    const nextTerms = productTerms
      .filter(item => item.id !== term.id)
      .map(item => term.preferredSupplier && Number(item.productId) === productId
        ? { ...item, preferredSupplier: false }
        : item)
    nextTerms.push(term)

    const submit = form.querySelector('[type="submit"]')
    submit.disabled = true
    try {
      const saved = await request("/api/admin/procurement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppliers, productTerms: nextTerms })
      })
      suppliers = Array.isArray(saved.suppliers) ? saved.suppliers : suppliers
      productTerms = Array.isArray(saved.productTerms) ? saved.productTerms : nextTerms
      renderTerms()
      resetForm(supplierId)
      showStatus("Costo y condición guardados. No se modificó el precio de venta.")
    } catch (error) {
      showStatus(`No se pudo guardar la condición: ${error.message}`, true)
    } finally {
      submit.disabled = false
    }
  })

  $("procurement-product-terms").addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-procurement-term]")
    if (edit) {
      const term = productTerms.find(item => item.id === edit.dataset.editProcurementTerm)
      if (term) {
        renderSupplierOptions(term.supplierId)
        populateForm(term)
        $("procurement-supplier").focus()
      }
      return
    }

    const remove = event.target.closest("[data-remove-procurement-term]")
    if (!remove || !confirm("¿Quitar esta condición de compra? Las órdenes existentes conservarán sus costos guardados.")) return
    const nextTerms = productTerms.filter(term => term.id !== remove.dataset.removeProcurementTerm)
    try {
      const saved = await request("/api/admin/procurement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppliers, productTerms: nextTerms })
      })
      suppliers = Array.isArray(saved.suppliers) ? saved.suppliers : suppliers
      productTerms = Array.isArray(saved.productTerms) ? saved.productTerms : nextTerms
      renderTerms()
      resetForm($("procurement-supplier").value)
      showStatus("Condición quitada. Las órdenes existentes no se modificaron.")
    } catch (error) {
      showStatus(`No se pudo quitar la condición: ${error.message}`, true)
    }
  })
})()
