(() => {
  const productsContainer = document.getElementById("products")
  if (!productsContainer) return

  const toolbar = document.createElement("section")
  toolbar.className = "mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
  toolbar.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <label class="inline-flex items-center gap-2 text-sm font-semibold">
        <input id="bulk-select-visible" type="checkbox" class="h-4 w-4 accent-amber-500">
        Seleccionar visibles
      </label>
      <span id="bulk-selected-count" class="text-xs text-slate-500">0 seleccionados</span>
      <span class="hidden h-5 border-l border-slate-300 sm:block"></span>
      <select id="bulk-offer-action" class="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" aria-label="Acción de oferta">
        <option value="">Oferta: sin cambios</option>
        <option value="on">Marcar oferta</option>
        <option value="off">Quitar oferta</option>
      </select>
      <button id="bulk-apply-offer" type="button" class="rounded bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white">Aplicar</button>
      <input id="bulk-discount-value" type="number" min="1" max="100" step="1" class="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Descuento %" aria-label="Porcentaje de descuento">
      <button id="bulk-apply-discount" type="button" class="rounded bg-amber-500 px-3 py-1.5 text-sm font-bold text-white">Aplicar descuento</button>
      <button id="bulk-clear-discount" type="button" class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm">Quitar descuento</button>
    </div>
    <p id="bulk-action-status" class="mt-2 text-xs text-slate-500">Las acciones afectan solo a los productos seleccionados. Guarda los cambios con “Guardar catálogo”.</p>
  `
  productsContainer.parentElement.insertBefore(toolbar, productsContainer)

  const visibleRows = () => Array.from(productsContainer.querySelectorAll("tbody tr[data-product]"))
  const selectedRows = () => visibleRows().filter(row => row.querySelector("[data-select-product]")?.checked)
  const updateSelection = () => {
    const rows = visibleRows()
    const selectedCount = selectedRows().length
    const selectAll = document.getElementById("bulk-select-visible")
    const headerCheckbox = productsContainer.querySelector("[data-select-visible]")
    document.getElementById("bulk-selected-count").textContent = `${selectedCount} seleccionados`
    for (const checkbox of [selectAll, headerCheckbox]) {
      if (!checkbox) continue
      checkbox.checked = rows.length > 0 && selectedCount === rows.length
      checkbox.indeterminate = selectedCount > 0 && selectedCount < rows.length
    }
  }

  function decorateTable() {
    const table = productsContainer.querySelector("table")
    const headerRow = table?.querySelector("thead tr")
    if (!table || !headerRow) return

    if (!headerRow.querySelector("[data-select-visible]")) {
      const header = document.createElement("th")
      header.className = "w-10 p-2 text-center"
      header.innerHTML = '<input type="checkbox" data-select-visible class="h-4 w-4 accent-amber-500" aria-label="Seleccionar todos los productos visibles">'
      headerRow.insertBefore(header, headerRow.firstChild)
    }

    for (const row of visibleRows()) {
      if (row.querySelector("[data-select-product]")) continue
      const cell = document.createElement("td")
      cell.className = "p-2 text-center"
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      checkbox.dataset.selectProduct = ""
      checkbox.className = "h-4 w-4 accent-amber-500"
      checkbox.setAttribute("aria-label", `Seleccionar ${row.querySelector("td")?.textContent.trim() || "producto"}`)
      cell.appendChild(checkbox)
      row.insertBefore(cell, row.firstChild)
    }
    updateSelection()
  }

  const observer = new MutationObserver(decorateTable)
  observer.observe(productsContainer, { childList: true, subtree: true })
  decorateTable()

  productsContainer.addEventListener("change", event => {
    if (event.target.matches("[data-select-visible]")) {
      for (const row of visibleRows()) row.querySelector("[data-select-product]").checked = event.target.checked
    }
    if (event.target.matches('[data-field="discount"]') && !event.target.checked) {
      const discountInput = event.target.closest("tr")?.querySelector('[data-field="discountPercent"]')
      if (discountInput) discountInput.value = ""
    }
    if (event.target.matches("[data-select-visible], [data-select-product]")) updateSelection()
  })

  document.getElementById("bulk-select-visible").addEventListener("change", event => {
    for (const row of visibleRows()) row.querySelector("[data-select-product]").checked = event.target.checked
    updateSelection()
  })

  function announce(message) {
    document.getElementById("bulk-action-status").textContent = message
  }

  document.getElementById("bulk-apply-offer").addEventListener("click", () => {
    const action = document.getElementById("bulk-offer-action").value
    const rows = selectedRows()
    if (!action) return announce("Elige si quieres marcar o quitar la oferta.")
    if (!rows.length) return announce("Selecciona al menos un producto visible.")
    for (const row of rows) row.querySelector('[data-field="offer"]').checked = action === "on"
    announce(`Oferta actualizada en ${rows.length} productos. Pulsa “Guardar catálogo” para confirmar.`)
  })

  document.getElementById("bulk-apply-discount").addEventListener("click", () => {
    const input = document.getElementById("bulk-discount-value")
    const percent = Number(input.value)
    const rows = selectedRows()
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) return announce("Indica un descuento entre 1 y 100 %.")
    if (!rows.length) return announce("Selecciona al menos un producto visible.")
    for (const row of rows) {
      row.querySelector('[data-field="discount"]').checked = true
      row.querySelector('[data-field="discountPercent"]').value = String(percent)
    }
    announce(`Descuento de ${percent} % aplicado a ${rows.length} productos. Pulsa “Guardar catálogo” para confirmar.`)
  })

  document.getElementById("bulk-clear-discount").addEventListener("click", () => {
    const rows = selectedRows()
    if (!rows.length) return announce("Selecciona al menos un producto visible.")
    for (const row of rows) {
      row.querySelector('[data-field="discount"]').checked = false
      row.querySelector('[data-field="discountPercent"]').value = ""
    }
    announce(`Descuento quitado de ${rows.length} productos. Pulsa “Guardar catálogo” para confirmar.`)
  })

})()