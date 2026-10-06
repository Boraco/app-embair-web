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

  const settingsSection = document.createElement("section")
  settingsSection.className = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
  settingsSection.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-sky-700">Portal de distribuidores</p>
        <h2 class="mt-1 text-xl font-bold">Carrusel de marcas y empresas</h2>
        <p class="mt-1 text-sm text-slate-500">Sube logos, cambia el orden y guárdalos para mostrarlos a clientes mayoristas.</p>
      </div>
      <button id="save-wholesale-logos" type="button" class="rounded-lg bg-[#10165c] px-4 py-2 text-sm font-bold text-white">Guardar logos</button>
    </div>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <input id="wholesale-logo-files" type="file" accept="image/*" multiple class="block max-w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:font-semibold file:text-sky-800">
      <span class="text-xs text-slate-500">PNG, JPG, WebP, SVG o GIF</span>
    </div>
    <div id="wholesale-logo-list" class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"></div>
    <p id="wholesale-logo-status" class="mt-3 text-sm text-slate-500" role="status" aria-live="polite">Los logos se muestran en el portal mayorista después de guardar.</p>
  `
  const productsSection = productsContainer.closest("section")
  if (productsSection) productsSection.appendChild(settingsSection)

  let logoSlides = []
  const logoList = document.getElementById("wholesale-logo-list")
  const logoStatus = document.getElementById("wholesale-logo-status")
  const setLogoStatus = message => { logoStatus.textContent = message }

  function renderLogoSlides() {
    logoList.replaceChildren()
    if (!logoSlides.length) {
      logoList.innerHTML = '<p class="text-sm text-slate-400 sm:col-span-2 lg:col-span-3">Aún no hay logos en el carrusel.</p>'
      return
    }

    logoSlides.forEach((slide, index) => {
      const card = document.createElement("div")
      card.className = "grid grid-cols-[4rem_1fr_auto] items-center gap-3 rounded-lg border border-slate-200 p-2"
      const image = document.createElement("img")
      image.src = slide.url
      image.alt = slide.alt || ""
      image.className = "h-14 w-16 rounded border border-slate-100 bg-white object-contain p-1"
      const fields = document.createElement("div")
      const altInput = document.createElement("input")
      altInput.type = "text"
      altInput.value = slide.alt || ""
      altInput.maxLength = 100
      altInput.placeholder = "Nombre de la marca"
      altInput.setAttribute("aria-label", `Nombre del logo ${index + 1}`)
      altInput.className = "w-full rounded border border-slate-300 px-2 py-1 text-sm"
      altInput.addEventListener("input", () => { logoSlides[index].alt = altInput.value })
      const url = document.createElement("p")
      url.className = "mt-1 truncate text-[10px] text-slate-400"
      url.textContent = slide.url
      fields.append(altInput, url)

      const actions = document.createElement("div")
      actions.className = "flex flex-col gap-1"
      const up = document.createElement("button")
      up.type = "button"
      up.textContent = "Subir"
      up.title = "Mover logo hacia arriba"
      up.disabled = index === 0
      const down = document.createElement("button")
      down.type = "button"
      down.textContent = "Bajar"
      down.title = "Mover logo hacia abajo"
      down.disabled = index === logoSlides.length - 1
      const remove = document.createElement("button")
      remove.type = "button"
      remove.textContent = "Quitar"
      remove.title = "Quitar logo del carrusel sin borrar la imagen"
      for (const button of [up, down, remove]) button.className = "rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
      up.addEventListener("click", () => moveLogo(index, -1))
      down.addEventListener("click", () => moveLogo(index, 1))
      remove.addEventListener("click", () => {
        logoSlides.splice(index, 1)
        renderLogoSlides()
        setLogoStatus("Logo quitado de la lista. Guarda los cambios para actualizar el portal.")
      })
      actions.append(up, down, remove)
      card.append(image, fields, actions)
      logoList.appendChild(card)
    })
  }

  function moveLogo(index, offset) {
    const target = index + offset
    if (target < 0 || target >= logoSlides.length) return
    ;[logoSlides[index], logoSlides[target]] = [logoSlides[target], logoSlides[index]]
    renderLogoSlides()
  }

  async function loadLogoSlides() {
    try {
      const response = await fetch("/api/config")
      if (!response.ok) throw new Error("No se pudo leer la configuración")
      const data = await response.json()
      logoSlides = Array.isArray(data.wholesaleLogoSlides)
        ? data.wholesaleLogoSlides.map(slide => typeof slide === "string" ? { url: slide, alt: "" } : slide).filter(slide => slide && slide.url)
        : []
      renderLogoSlides()
    } catch (error) {
      setLogoStatus(error.message || "No se pudieron cargar los logos.")
    }
  }

  document.getElementById("wholesale-logo-files").addEventListener("change", async event => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    event.target.disabled = true
    setLogoStatus(`Subiendo ${files.length} logo(s)...`)
    let uploaded = 0
    try {
      for (const file of files) {
        const formData = new FormData()
        formData.append("file", file)
        const response = await fetchAdmin("/api/upload", { method: "POST", body: formData })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.url) throw new Error(result.error || `No se pudo subir ${file.name}`)
        logoSlides.push({ url: result.url, alt: file.name.replace(/\.[^.]+$/, "") })
        uploaded++
      }
      renderLogoSlides()
      setLogoStatus(`${uploaded} logo(s) subido(s). Guarda los cambios para publicarlos en el portal.`)
    } catch (error) {
      renderLogoSlides()
      setLogoStatus(error.message || "Error al subir logos.")
    } finally {
      event.target.disabled = false
      event.target.value = ""
    }
  })

  document.getElementById("save-wholesale-logos").addEventListener("click", async event => {
    const button = event.currentTarget
    button.disabled = true
    try {
      const response = await fetchAdmin("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wholesaleLogoSlides: logoSlides })
      })
      if (!response.ok) throw new Error("No se pudieron guardar los logos. Verifica tus credenciales administrativas.")
      setLogoStatus("Logos guardados. El carrusel ya está actualizado para el portal mayorista.")
    } catch (error) {
      setLogoStatus(error.message || "No se pudieron guardar los logos.")
    } finally {
      button.disabled = false
    }
  })

  loadLogoSlides()
})()