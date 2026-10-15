(() => {
  const productsContainer = document.getElementById("products")
  if (!productsContainer) return

  const selectedProductIds = new Set()
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
      <button id="bulk-export-catalog-pdf" type="button" class="rounded bg-[#10165c] px-3 py-1.5 text-sm font-bold text-white">PDF de seleccionados</button>
    </div>
    <p id="bulk-action-status" class="mt-2 text-xs text-slate-500">La selección se conserva al cambiar filtros. Las acciones aplican a los seleccionados visibles; el PDF incluye toda la selección.</p>
  `
  productsContainer.parentElement.insertBefore(toolbar, productsContainer)

  const visibleRows = () => Array.from(productsContainer.querySelectorAll("tbody tr[data-product]"))
  const selectedRows = () => visibleRows().filter(row => row.querySelector("[data-select-product]")?.checked)
  const updateSelection = () => {
    const rows = visibleRows()
    const selectedCount = selectedProductIds.size
    const selectAll = document.getElementById("bulk-select-visible")
    const headerCheckbox = productsContainer.querySelector("[data-select-visible]")
    document.getElementById("bulk-selected-count").textContent = `${selectedCount} seleccionados`
    for (const checkbox of [selectAll, headerCheckbox]) {
      if (!checkbox) continue
      const visibleSelected = rows.filter(row => selectedProductIds.has(Number(row.dataset.product))).length
      checkbox.checked = rows.length > 0 && visibleSelected === rows.length
      checkbox.indeterminate = visibleSelected > 0 && visibleSelected < rows.length
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
      checkbox.checked = selectedProductIds.has(Number(row.dataset.product))
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
      for (const row of visibleRows()) {
        const productId = Number(row.dataset.product)
        if (event.target.checked) selectedProductIds.add(productId)
        else selectedProductIds.delete(productId)
        row.querySelector("[data-select-product]").checked = event.target.checked
      }
    }
    if (event.target.matches("[data-select-product]")) {
      const productId = Number(event.target.closest("tr[data-product]")?.dataset.product)
      if (event.target.checked) selectedProductIds.add(productId)
      else selectedProductIds.delete(productId)
    }
    if (event.target.matches('[data-field="discount"]') && !event.target.checked) {
      const discountInput = event.target.closest("tr")?.querySelector('[data-field="discountPercent"]')
      if (discountInput) discountInput.value = ""
    }
    if (event.target.matches("[data-select-visible], [data-select-product]")) updateSelection()
  })

  document.getElementById("bulk-select-visible").addEventListener("change", event => {
    for (const row of visibleRows()) {
      const productId = Number(row.dataset.product)
      if (event.target.checked) selectedProductIds.add(productId)
      else selectedProductIds.delete(productId)
      row.querySelector("[data-select-product]").checked = event.target.checked
    }
    updateSelection()
  })

  function announce(message) {
    document.getElementById("bulk-action-status").textContent = message
  }

  function imageAsDataUrl(src) {
    return new Promise((resolve, reject) => {
      const url = new URL(src, window.location.href)
      if (url.origin !== window.location.origin) return reject(new Error("La imagen no pertenece a este sitio."))
      fetch(url.href).then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar la imagen (HTTP ${response.status}).`)
        return response.blob()
      }).then(blob => {
        const reader = new FileReader()
        reader.onload = () => {
          const image = new Image()
          image.onload = () => {
            const canvas = document.createElement("canvas")
            canvas.width = 300
            canvas.height = 300
            const context = canvas.getContext("2d")
            if (!context) return reject(new Error("No se pudo preparar la imagen para el PDF."))
            context.fillStyle = "#ffffff"
            context.fillRect(0, 0, canvas.width, canvas.height)
            const scale = Math.min(canvas.width / image.width, canvas.height / image.height)
            const width = image.width * scale
            const height = image.height * scale
            context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
            resolve(canvas.toDataURL("image/jpeg", 0.9))
          }
          image.onerror = () => reject(new Error("El archivo no es una imagen compatible."))
          image.src = reader.result
        }
        reader.onerror = () => reject(new Error("No se pudo leer la imagen del producto."))
        reader.readAsDataURL(blob)
      }).catch(reject)
    })
  }

  function exportCatalogPdf() {
    if (!selectedProductIds.size) return announce("Selecciona al menos un producto para generar el PDF.")
    if (!window.jspdf?.jsPDF) return announce("No se pudo cargar el generador PDF. Recarga la página e inténtalo nuevamente.")

    const selectedProducts = catalog
      .filter(product => selectedProductIds.has(Number(product.id)))
      .map(product => ({ product, config: current(product.id) }))
      .sort((a, b) => Number(a.config.catalogOrder ?? 999) - Number(b.config.catalogOrder ?? 999)
        || String(a.product.name || "").localeCompare(String(b.product.name || ""), "es"))
    if (!selectedProducts.length) return announce("No hay productos seleccionados disponibles para exportar.")

    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const columns = [10, 32, 88, 40, 25, 25, 32, 25]
    const headers = ["Orden", "Imagen", "Producto", "Empaque", "Und./paq.", "Mínimo", "Precio/paq.", "Estado"]
    let missingImages = 0
    let y = 34

    function drawPageHeader() {
      doc.setFillColor(16, 22, 92)
      doc.rect(0, 0, pageWidth, 21, "F")
      doc.setTextColor(255, 255, 255)
      doc.setFont("helvetica", "bold")
      doc.setFontSize(15)
      doc.text("EMBAIR · CATÁLOGO MAYORISTA", 10, 9)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.text(`Generado ${new Date().toLocaleDateString("es-AR")} · ${selectedProducts.length} productos`, 10, 16)
      doc.setTextColor(30, 41, 59)
      let x = 10
      doc.setFillColor(241, 245, 249)
      doc.rect(10, 25, pageWidth - 20, 7, "F")
      doc.setFont("helvetica", "bold")
      doc.setFontSize(7)
      headers.forEach((label, index) => {
        doc.text(label, x + 1, 29.5)
        x += columns[index]
      })
      y = 34
    }

    async function drawProductRow(entry, index) {
      const { product, config } = entry
      const rowHeight = 34
      if (y + rowHeight > pageHeight - 12) {
        doc.addPage()
        drawPageHeader()
      }
      if (index % 2 === 0) {
        doc.setFillColor(250, 250, 252)
        doc.rect(10, y, pageWidth - 20, rowHeight, "F")
      }
      doc.setDrawColor(226, 232, 240)
      doc.rect(10, y, pageWidth - 20, rowHeight)
      const values = [
        String(index + 1),
        "",
        "",
        String(config.packageName || "Paquete"),
        String(config.unitsPerPackage || 1),
        `${config.minimumQuantity || 1} paq.`,
        config.wholesalePrice == null
          ? "Consultar"
          : `$${(Number(config.wholesalePrice) * (1 - Number(config.discountPercent || 0) / 100)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        config.enabled === true ? (config.availability || "Disponible") : "No publicado"
      ]
      let x = 10
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7)
      doc.setTextColor(30, 41, 59)
      values.forEach((value, cellIndex) => {
        if (cellIndex !== 1 && cellIndex !== 2) {
          const lines = doc.splitTextToSize(value, columns[cellIndex] - 3)
          doc.text(lines.slice(0, 3), x + 1, y + 5)
        }
        x += columns[cellIndex]
      })
      const productX = 10 + columns[0] + columns[1]
      const productLines = doc.splitTextToSize(String(product.name || "Producto"), columns[2] - 3)
      doc.setFont("helvetica", "bold")
      doc.text(productLines.slice(0, 2), productX + 1, y + 6)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(6.5)
      const details = [product.code || product.sku, product.category || product.categoria].filter(Boolean).join(" · ")
      if (details) doc.text(doc.splitTextToSize(details, columns[2] - 3).slice(0, 2), productX + 1, y + 16)
      if (product.img) {
        try {
          const dataUrl = await imageAsDataUrl(product.img)
          doc.addImage(dataUrl, "JPEG", 21, y + 2, 30, 30, undefined, "FAST")
        } catch (error) {
          missingImages++
          doc.setFontSize(6)
          doc.setTextColor(100, 116, 139)
          doc.text("Sin imagen", 21, y + 18)
        }
      } else {
        missingImages++
        doc.setFontSize(6)
        doc.setTextColor(100, 116, 139)
        doc.text("Sin imagen", 21, y + 18)
      }
      y += rowHeight
    }

    async function generate() {
      try {
        drawPageHeader()
        for (const [index, entry] of selectedProducts.entries()) await drawProductRow(entry, index)
        doc.save("catalogo-mayorista-seleccionados.pdf")
        announce(`PDF generado con ${selectedProducts.length} productos${missingImages ? `; ${missingImages} sin imagen disponible` : ""}.`)
      } catch (error) {
        console.error("Error generando el catálogo mayorista PDF:", error)
        announce("No se pudo generar el PDF del catálogo. Inténtalo nuevamente.")
      }
    }
    generate()
  }

  document.getElementById("bulk-export-catalog-pdf").addEventListener("click", exportCatalogPdf)

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