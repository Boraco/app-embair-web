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

  function ensureAutoTable() {
    const { jsPDF } = window.jspdf
    window.jsPDF = jsPDF
    if (typeof jsPDF.API.autoTable === "function") return Promise.resolve()

    return new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js"
      script.onload = () => {
        if (typeof jsPDF.API.autoTable === "function") resolve()
        else reject(new Error("No se pudo inicializar la tabla del PDF."))
      }
      script.onerror = () => reject(new Error("No se pudo cargar el formato de tabla para el PDF."))
      document.head.appendChild(script)
    })
  }

  function getConsecutiveImageGroups(entries) {
    const groups = []
    entries.forEach((entry, index) => {
      const url = String(entry.product.img || "")
      if (!url) return
      const previous = groups[groups.length - 1]
      if (previous && previous.url === url && previous.end === index - 1) {
        previous.end = index
      } else {
        groups.push({ url, start: index, end: index })
      }
    })
    return groups
  }

  async function exportCatalogPdf() {
    if (!selectedProductIds.size) return announce("Selecciona al menos un producto para generar el PDF.")
    if (!window.jspdf?.jsPDF) return announce("No se pudo cargar el generador PDF. Recarga la página e inténtalo nuevamente.")

    const selectedProducts = catalog
      .filter(product => selectedProductIds.has(Number(product.id)))
      .map(product => ({ product, config: current(product.id) }))
      .sort((a, b) => Number(a.config.catalogOrder ?? 999) - Number(b.config.catalogOrder ?? 999)
        || String(a.product.name || "").localeCompare(String(b.product.name || ""), "es"))
    if (!selectedProducts.length) return announce("No hay productos seleccionados disponibles para exportar.")

    const exportButton = document.getElementById("bulk-export-catalog-pdf")
    const originalButtonText = exportButton.textContent
    exportButton.disabled = true
    let missingImages = 0
    let logoUnavailable = false

    try {
      await ensureAutoTable()
      const { jsPDF } = window.jspdf
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 10
      const logoData = await imageAsDataUrl("/img/embair-isotype-white.png", null).catch(error => {
        logoUnavailable = true
        console.error("No se pudo cargar el isotipo para el catálogo PDF:", error)
        return null
      })

      const imageUrls = Array.from(new Set(selectedProducts.map(({ product }) => String(product.img || "")).filter(Boolean)))
      const imageDataByUrl = new Map()
      for (let index = 0; index < imageUrls.length; index += 8) {
        const batch = imageUrls.slice(index, index + 8)
        const results = await Promise.all(batch.map(async url => {
          try {
            return [url, await imageAsDataUrl(url)]
          } catch (error) {
            console.warn(`No se pudo cargar la imagen del catálogo (${url}):`, error)
            return [url, null]
          }
        }))
        results.forEach(([url, data]) => imageDataByUrl.set(url, data))
        announce(`Preparando imágenes ${Math.min(index + batch.length, imageUrls.length)}/${imageUrls.length} para el PDF.`)
      }
      missingImages = imageUrls.filter(url => !imageDataByUrl.get(url)).length

      const rows = selectedProducts.map(({ product, config }) => {
        const units = Math.max(1, Number(config.unitsPerPackage) || 1)
        const unitBasePrice = config.unitWholesalePrice == null ? null : Number(config.unitWholesalePrice)
        const packageBasePrice = config.wholesalePrice == null
          ? unitBasePrice == null ? null : Number((unitBasePrice * units).toFixed(2))
          : Number(config.wholesalePrice)
        const discount = Math.min(100, Math.max(0, Number(config.discountPercent) || 0))
        const packagePrice = packageBasePrice == null
          ? null
          : Number((packageBasePrice * (1 - discount / 100)).toFixed(2))
        const unitPrice = unitBasePrice == null
          ? packageBasePrice == null ? null : Number((packageBasePrice / units).toFixed(2))
          : unitBasePrice
        const availability = String(config.availability || "Disponible")
        const availabilityColor = availability === "Agotado"
          ? [220, 38, 38]
          : availability === "Bajo Pedido" ? [217, 119, 6] : [22, 163, 74]
        const code = String(product.code || product.sku || "").trim()

        return {
          image: imageDataByUrl.get(String(product.img || "")) || null,
          name: [
            product.name || "Producto",
            code ? `Código: ${code}` : "",
            product.category || product.categoria || ""
          ].filter(Boolean).join("\n"),
          unitPrice: unitPrice == null ? "Consultar" : wholesaleMoney(unitPrice),
          packageName: config.packageName || "Paquete",
          units,
          minimum: `${Math.max(1, Number(config.minimumQuantity) || 1)} paquetes`,
          availability,
          availabilityColor,
          packagePrice: packagePrice == null ? "Consultar" : wholesaleMoney(packagePrice)
        }
      })

      const imageGroups = getConsecutiveImageGroups(selectedProducts)
      const imageGroupByRow = new Map()
      imageGroups.forEach(group => {
        for (let index = group.start; index <= group.end; index++) imageGroupByRow.set(index, group)
      })
      const drawnImageGroupsByPage = new Set()
      const generatedAt = new Date().toLocaleDateString("es-AR")

      doc.autoTable({
        startY: 31,
        margin: { left: margin, right: margin, top: 31, bottom: 12 },
        head: [["Imagen", "Producto / Código / Categoría", "Mayorista por unidad", "Empaque", "Unid./paq.", "Mínimo", "Estado", "Mayorista por empaque"]],
        body: rows.map(row => [row.image, row.name, row.unitPrice, row.packageName, row.units, row.minimum, row.availability.toUpperCase(), row.packagePrice]),
        styles: {
          fontSize: 7.5,
          cellPadding: 1.5,
          valign: "middle",
          lineColor: [229, 231, 235],
          lineWidth: 0.1,
          overflow: "linebreak"
        },
        headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: "bold", halign: "center" },
        bodyStyles: { minCellHeight: 15, textColor: [50, 50, 50] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 14 },
          1: { cellWidth: 58, fontStyle: "bold", fontSize: 7 },
          2: { cellWidth: 22, halign: "right" },
          3: { cellWidth: 22, fontSize: 7 },
          4: { cellWidth: 13, halign: "center" },
          5: { cellWidth: 15, halign: "center" },
          6: { cellWidth: 19, halign: "center", fontStyle: "bold", fontSize: 6.5 },
          7: { cellWidth: 27, halign: "right" }
        },
        didDrawPage: data => {
          const pageNumber = doc.internal.getCurrentPageInfo().pageNumber
          doc.setFillColor(16, 22, 92)
          doc.rect(0, 0, pageWidth, 27, "F")
          if (logoData) {
            doc.addImage(logoData, "PNG", margin, 3, 14, 14)
            doc.setDrawColor(255, 255, 255)
            doc.setLineWidth(0.2)
            doc.line(27, 3, 27, 17)
          }
          doc.setTextColor(255, 255, 255)
          doc.setFont("helvetica", "bold")
          doc.setFontSize(13)
          doc.text("EMBAIR · CATÁLOGO MAYORISTA", logoData ? 32 : margin, 10)
          doc.setFont("helvetica", "normal")
          doc.setFontSize(7.5)
          doc.text(`Precios mayoristas · ${selectedProducts.length} productos · Generado ${generatedAt}`, logoData ? 32 : margin, 18)
          doc.text(`Página ${pageNumber}`, pageWidth - margin, 18, { align: "right" })
        },
        didParseCell: data => {
          if (data.section === "body" && data.column.index === 0) data.cell.text = []
          if (data.section === "body" && data.column.index === 6) {
            data.cell.styles.textColor = rows[data.row.index].availabilityColor
          }
        },
        didDrawCell: data => {
          if (data.section !== "body" || data.column.index !== 0) return
          const rowIndex = data.row.index
          const group = imageGroupByRow.get(rowIndex)
          if (!group) return
          const pageNumber = doc.internal.getCurrentPageInfo().pageNumber
          const pageGroupKey = `${pageNumber}:${group.start}`
          if (drawnImageGroupsByPage.has(pageGroupKey)) return
          drawnImageGroupsByPage.add(pageGroupKey)

          const bodyRows = data.table.body || []
          const groupHeight = bodyRows
            .slice(rowIndex, group.end + 1)
            .reduce((height, row) => height + Number(row.height || data.row.height || 15), 0)
          const pageBottom = pageHeight - 12
          const visibleHeight = Math.max(0, Math.min(groupHeight, pageBottom - data.cell.y))
          const imageSize = Math.min(12, visibleHeight - 2)
          const image = rows[rowIndex].image
          if (!image || imageSize < 4) return
          doc.addImage(
            image,
            "JPEG",
            data.cell.x + (data.cell.width - imageSize) / 2,
            data.cell.y + (visibleHeight - imageSize) / 2,
            imageSize,
            imageSize
          )
        }
      })

      const pageCount = doc.internal.getNumberOfPages()
      for (let page = 1; page <= pageCount; page++) {
        doc.setPage(page)
        doc.setFont("helvetica", "normal")
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        doc.text(`Página ${page} de ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: "right" })
      }

      doc.save("catalogo-mayorista-seleccionados.pdf")
      announce(`PDF generado con ${selectedProducts.length} productos${missingImages ? `; ${missingImages} sin imagen disponible` : ""}${logoUnavailable ? "; isotipo no disponible" : ""}.`)
    } catch (error) {
      console.error("Error generando el catálogo mayorista PDF:", error)
      announce(`No se pudo generar el PDF del catálogo: ${error.message}`)
    } finally {
      exportButton.disabled = false
      exportButton.textContent = originalButtonText
    }
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