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

  function imageAsDataUrl(src, backgroundColor = "#ffffff") {
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
            if (backgroundColor) {
              context.fillStyle = backgroundColor
              context.fillRect(0, 0, canvas.width, canvas.height)
            }
            const scale = Math.min(canvas.width / image.width, canvas.height / image.height)
            const width = image.width * scale
            const height = image.height * scale
            context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
            resolve(backgroundColor
              ? canvas.toDataURL("image/jpeg", 0.9)
              : canvas.toDataURL("image/png"))
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
    const gridColumns = 4
    const gridRows = 3
    const pageCapacity = gridColumns * gridRows
    const margin = 8
    const gap = 4
    const cardWidth = (pageWidth - margin * 2 - gap * (gridColumns - 1)) / gridColumns
    const cardHeight = 55
    const gridTop = 25
    let missingImages = 0
    let logoData = null
    let logoUnavailable = false

    function drawPageHeader(pageNumber) {
      doc.setFillColor(16, 22, 92)
      doc.rect(0, 0, pageWidth, 21, "F")
      if (logoData) {
        doc.addImage(logoData, "PNG", margin, 3.5, 15, 14)
        doc.setDrawColor(255, 255, 255)
        doc.setLineWidth(0.2)
        doc.line(26, 4, 26, 17)
      }
      doc.setTextColor(255, 255, 255)
      doc.setFont("helvetica", "bold")
      doc.setFontSize(14)
      doc.text("EMBAIR · CATÁLOGO MAYORISTA", logoData ? 31 : margin, 9)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7.5)
      doc.text(`Precios mayoristas · ${selectedProducts.length} productos · Generado ${new Date().toLocaleDateString("es-AR")}`, logoData ? 31 : margin, 16)
      doc.text(`Página ${pageNumber} de ${Math.ceil(selectedProducts.length / pageCapacity)}`, pageWidth - margin, 16, { align: "right" })
    }

    async function drawProductCard(entry, index) {
      const { product, config } = entry
      const position = index % pageCapacity
      const column = position % gridColumns
      const row = Math.floor(position / gridColumns)
      const x = margin + column * (cardWidth + gap)
      const y = gridTop + row * (cardHeight + gap)
      const contentX = x + 3
      const contentWidth = cardWidth - 6

      doc.setFillColor(255, 255, 255)
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.35)
      doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "FD")

      doc.setFillColor(248, 250, 252)
      doc.roundedRect(contentX, y + 2, contentWidth, 19, 1, 1, "F")
      if (product.img) {
        try {
          const dataUrl = await imageAsDataUrl(product.img)
          doc.addImage(dataUrl, "JPEG", contentX + (contentWidth - 25) / 2, y + 2.5, 25, 18, undefined, "FAST")
        } catch (error) {
          missingImages++
          doc.setFont("helvetica", "normal")
          doc.setFontSize(6)
          doc.setTextColor(100, 116, 139)
          doc.text("Imagen no disponible", x + cardWidth / 2, y + 12.5, { align: "center" })
        }
      } else {
        missingImages++
        doc.setFont("helvetica", "normal")
        doc.setFontSize(6)
        doc.setTextColor(100, 116, 139)
        doc.text("Sin imagen", x + cardWidth / 2, y + 12.5, { align: "center" })
      }

      doc.setTextColor(148, 163, 184)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(5.5)
      doc.text(String(index + 1).padStart(2, "0"), x + cardWidth - 3, y + 4.5, { align: "right" })

      doc.setFont("helvetica", "bold")
      doc.setFontSize(7)
      doc.setTextColor(30, 41, 59)
      const productLines = doc.splitTextToSize(String(product.name || "Producto"), contentWidth)
      doc.text(productLines.slice(0, 2), contentX, y + 25, { lineHeightFactor: 1.05 })

      doc.setFont("helvetica", "normal")
      doc.setFontSize(5.5)
      doc.setTextColor(100, 116, 139)
      const code = String(product.code || product.sku || "").trim()
      if (code) doc.text(doc.splitTextToSize(code, contentWidth)[0], contentX, y + 33)

      doc.setDrawColor(241, 245, 249)
      doc.line(contentX, y + 35, x + cardWidth - 3, y + 35)
      doc.setTextColor(71, 85, 105)
      doc.setFontSize(6)
      const packageDetails = `${config.packageName || "Paquete"} · ${config.unitsPerPackage || 1} und./paq.`
      doc.text(doc.splitTextToSize(packageDetails, contentWidth)[0], contentX, y + 39)
      doc.setFontSize(5.5)
      doc.text(`Mínimo: ${config.minimumQuantity || 1} paquetes`, contentX, y + 43)

      const price = config.wholesalePrice == null
        ? "Consultar"
        : `$${(Number(config.wholesalePrice) * (1 - Number(config.discountPercent || 0) / 100)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      doc.setFillColor(255, 247, 237)
      doc.roundedRect(contentX, y + 45, contentWidth, 7, 1, 1, "F")
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(154, 52, 18)
      doc.text(price, x + cardWidth / 2, y + 50, { align: "center" })
    }

    async function generate() {
      try {
        try {
          logoData = await imageAsDataUrl("/img/embair-isotype-white.png", null)
        } catch (error) {
          logoUnavailable = true
          console.error("No se pudo cargar el isotipo para el catálogo PDF:", error)
        }
        const pageCount = Math.ceil(selectedProducts.length / pageCapacity)
        for (let page = 0; page < pageCount; page++) {
          if (page > 0) doc.addPage()
          drawPageHeader(page + 1)
          const start = page * pageCapacity
          const end = Math.min(start + pageCapacity, selectedProducts.length)
          for (let index = start; index < end; index++) await drawProductCard(selectedProducts[index], index)
        }
        doc.save("catalogo-mayorista-seleccionados.pdf")
        announce(`PDF generado con ${selectedProducts.length} productos${missingImages ? `; ${missingImages} sin imagen disponible` : ""}${logoUnavailable ? "; isotipo no disponible" : ""}.`)
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