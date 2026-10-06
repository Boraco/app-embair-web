(() => {
  const main = document.querySelector("main")
  const catalogSection = main?.querySelector("#products")?.closest("section")
  const ordersSection = main?.querySelector("#orders")?.closest("section")
  const activitySection = main?.querySelector("#activity")?.closest("section")
  const logoSettingsSection = document.getElementById("wholesale-logo-files")?.closest("section")
  if (!main || !catalogSection || !ordersSection || !activitySection) return

  const paymentLabels = { cash: "Contado", credit: "Crédito" }
  let orders = []
  let drafts = []
  let activity = []
  let activeTab = "orders"
  let negotiationFilterValue = ""

  const make = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = String(text)
    return node
  }
  const button = (text, className, onClick) => {
    const node = make("button", className, text)
    node.type = "button"
    node.addEventListener("click", onClick)
    return node
  }
  const money = value => "$" + Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const formatDate = value => {
    if (!value) return "Sin fecha"
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? "Sin fecha" : date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
  }
  const localDateTime = value => {
    if (!value) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  }
  const option = (select, value, label, selected) => {
    const item = make("option", "", label)
    item.value = value
    item.selected = value === selected
    select.appendChild(item)
  }
  const panelCard = () => make("section", "rounded-lg border border-slate-200 bg-white p-4")

  const nav = make("nav", "mb-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2")
  nav.setAttribute("aria-label", "Flujo mayorista")
  const tabs = new Map()
  const dashboardPanel = make("section", "hidden space-y-4")
  const schedulePanel = make("section", "hidden")
  const orderWorkspace = make("div", "mt-4 space-y-4")

  function setActiveTab(tab) {
    activeTab = tab
    for (const [name, control] of tabs) {
      const active = name === tab
      control.setAttribute("aria-current", active ? "page" : "false")
      control.className = active
        ? "rounded-md bg-[#10165c] px-4 py-2 text-sm font-bold text-white"
        : "rounded-md px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
    }
    catalogSection.classList.toggle("hidden", tab !== "catalog")
    logoSettingsSection?.classList.toggle("hidden", tab !== "catalog")
    ordersSection.classList.toggle("hidden", tab !== "orders")
    activitySection.classList.toggle("hidden", tab !== "activity")
    schedulePanel.classList.toggle("hidden", tab !== "schedule")
    dashboardPanel.classList.toggle("hidden", tab !== "dashboard")
    if (tab === "orders") renderOrdersView()
    if (tab === "schedule") renderSchedule()
    if (tab === "dashboard") renderDashboard()
  }

  for (const [name, label] of [["orders", "Pedidos"], ["schedule", "Programación"], ["activity", "Actividad"], ["dashboard", "Dashboard"], ["catalog", "Productos"]]) {
    const control = button(label, "rounded-md px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100", () => setActiveTab(name))
    control.setAttribute("aria-current", "false")
    nav.appendChild(control)
    tabs.set(name, control)
  }

  const oldOrderTable = ordersSection.querySelector("#orders")?.closest(".overflow-x-auto")
  if (oldOrderTable) oldOrderTable.classList.add("hidden")
  ordersSection.appendChild(orderWorkspace)
  main.insertBefore(nav, catalogSection)
  main.append(schedulePanel, dashboardPanel)

  const refreshOrders = ordersSection.querySelector("#refresh-orders")
  if (refreshOrders) refreshOrders.addEventListener("click", loadWorkflow)
  const refreshActivity = activitySection.querySelector("#refresh-activity")
  if (refreshActivity) refreshActivity.addEventListener("click", loadWorkflow)

  async function getJson(path) {
    const response = await fetchAdmin(path)
    if (!response.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${response.status})`)
    return response.json()
  }
  async function sendJson(path, body, method = "POST") {
    const response = await fetchAdmin(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `No se pudo guardar (HTTP ${response.status})`)
    return result
  }
  function setStatus(message, parent) {
    let status = parent.querySelector("[data-workflow-status]")
    if (!status) {
      status = make("p", "text-xs text-rose-700")
      status.dataset.workflowStatus = ""
      parent.appendChild(status)
    }
    status.textContent = message
  }

  function renderDrafts() {
    const panel = panelCard()
    const heading = make("div", "mb-3 flex flex-wrap items-center justify-between gap-2")
    heading.append(make("h3", "font-bold", `Bandeja sin enviar (${drafts.length})`))
    heading.append(button("Actualizar", "rounded border border-slate-300 px-3 py-1.5 text-sm", loadWorkflow))
    panel.appendChild(heading)
    if (!drafts.length) {
      panel.append(make("p", "py-5 text-center text-sm text-slate-500", "No hay carritos mayoristas activos pendientes."))
      return panel
    }
    const list = make("div", "space-y-3")
    for (const draft of drafts) {
      const row = make("article", "grid gap-3 rounded-lg border border-slate-200 p-3 lg:grid-cols-[1fr_1fr_auto]")
      const client = make("div", "min-w-0")
      client.append(make("h4", "font-semibold", draft.client.name || draft.client.email || "Cliente mayorista"))
      client.append(make("p", "text-xs text-slate-500", [draft.client.company, draft.client.email, draft.client.phone, draft.client.zone].filter(Boolean).join(" · ") || "Sin datos de contacto"))
      client.append(make("p", "mt-1 text-xs text-slate-400", `Actualizado ${formatDate(draft.updatedAt)}`))
      const details = make("div", "space-y-1 text-sm")
      for (const product of draft.items) details.append(make("p", "", `${product.qty} × ${product.name} · ${product.packageName || "Paquete"} · ${money(product.subtotal)}`))
      details.append(make("p", "font-bold", `Total estimado ${money(draft.total)}`))
      const actions = make("div", "flex flex-col gap-2")
      const negotiation = document.createElement("select")
      negotiation.className = "rounded border border-slate-300 px-2 py-2 text-sm"
      negotiation.setAttribute("aria-label", "Tipo de negociación")
      option(negotiation, "", "Tipo de negociación…", "")
      option(negotiation, "cash", "Contado", "")
      option(negotiation, "credit", "Crédito", "")
      const confirmButton = button("Confirmar pedido", "rounded bg-[#10165c] px-3 py-2 text-sm font-bold text-white", async () => {
        if (!negotiation.value) return setStatus("Elige contado o crédito para confirmar este pedido.", actions)
        confirmButton.disabled = true
        try {
          await sendJson(`/api/admin/wholesale/inbox/${encodeURIComponent(draft.id)}/convert`, { paymentMethod: negotiation.value })
          await loadWorkflow()
        } catch (error) {
          setStatus(error.message, actions)
          confirmButton.disabled = false
        }
      })
      actions.append(negotiation, confirmButton)
      row.append(client, details, actions)
      list.appendChild(row)
    }
    panel.appendChild(list)
    return panel
  }

  function addOrderItems(parent, order) {
    const details = document.createElement("details")
    details.className = "mt-3 rounded border border-slate-200"
    details.open = true
    details.appendChild(make("summary", "cursor-pointer px-3 py-2 text-sm font-semibold", `Ver productos (${(order.items || []).length})`))
    const list = make("div", "space-y-3 border-t border-slate-200 p-3")
    for (const product of order.items || []) {
      const itemRow = make("div", "grid gap-2 border-b border-slate-100 pb-3 last:border-0 sm:grid-cols-[1fr_1.1fr_1fr_1fr]")
      itemRow.dataset.procurementProduct = String(product.productId)
      const identity = make("div", "text-sm")
      identity.append(make("p", "font-semibold", `${product.qty || 0} × ${product.name || "Producto"}`))
      identity.append(make("p", "text-xs text-slate-500", `${product.packageName || "Paquete"} · ${product.unitsPerPackage || 1} und. · ${money(product.subtotal)}`))

      const procurementStatus = document.createElement("select")
      procurementStatus.dataset.procurementField = "status"
      procurementStatus.className = "rounded border border-slate-300 px-2 py-1.5 text-xs"
      procurementStatus.setAttribute("aria-label", `Abastecimiento de ${product.name}`)
      const savedStatus = product.procurementStatus || "review"
      for (const [value, label] of [["review", "Por revisar"], ["supplier_needed", "Solicitar a proveedor"], ["requested", "Solicitado"], ["received", "Recibido"], ["not_required", "No requiere compra"]]) option(procurementStatus, value, label, savedStatus)

      const supplier = document.createElement("input")
      supplier.dataset.procurementField = "supplier"
      supplier.type = "text"
      supplier.maxLength = 120
      supplier.value = product.procurementSupplier || ""
      supplier.placeholder = "Proveedor"
      supplier.className = "rounded border border-slate-300 px-2 py-1.5 text-xs"
      supplier.setAttribute("aria-label", `Proveedor de ${product.name}`)

      const expectedAt = document.createElement("input")
      expectedAt.dataset.procurementField = "expectedAt"
      expectedAt.type = "date"
      expectedAt.value = product.procurementExpectedAt ? String(product.procurementExpectedAt).slice(0, 10) : ""
      expectedAt.className = "rounded border border-slate-300 px-2 py-1.5 text-xs"
      expectedAt.setAttribute("aria-label", `Llegada estimada de ${product.name}`)

      const notes = document.createElement("input")
      notes.dataset.procurementField = "notes"
      notes.type = "text"
      notes.maxLength = 300
      notes.value = product.procurementNotes || ""
      notes.placeholder = "Nota o referencia de compra"
      notes.className = "rounded border border-slate-300 px-2 py-1.5 text-xs sm:col-span-4"
      notes.setAttribute("aria-label", `Nota de abastecimiento de ${product.name}`)

      itemRow.append(identity, procurementStatus, supplier, expectedAt, notes)
      list.appendChild(itemRow)
    }
    details.appendChild(list)
    parent.appendChild(details)
  }

  function collectProcurementItems(orderElement) {
    return Array.from(orderElement.querySelectorAll("[data-procurement-product]"), row => ({
      productId: Number(row.dataset.procurementProduct),
      status: row.querySelector('[data-procurement-field="status"]').value,
      supplier: row.querySelector('[data-procurement-field="supplier"]').value,
      expectedAt: row.querySelector('[data-procurement-field="expectedAt"]').value,
      notes: row.querySelector('[data-procurement-field="notes"]').value
    }))
  }

  function procurementIsResolved(items) {
    return items.every(product => ["received", "not_required"].includes(product.status))
  }

  function renderOrderCard(order) {
    const item = panelCard()
    item.classList.add("space-y-3")
    const header = make("div", "flex flex-wrap items-start justify-between gap-3")
    const identity = make("div", "min-w-0")
    identity.append(make("h4", "font-bold", `${order.id} · ${order.client?.name || order.client?.email || "Cliente"}`))
    identity.append(make("p", "text-xs text-slate-500", [order.client?.company, order.client?.email, order.client?.phone, order.client?.zone].filter(Boolean).join(" · ") || "Sin datos de contacto"))
    identity.append(make("p", "mt-1 text-xs text-slate-400", `Recibido ${formatDate(order.createdAt)} · Total ${money(order.total)}`))
    header.appendChild(identity)
    header.appendChild(make("span", "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold", paymentLabels[order.paymentMethod] || "Por definir"))
    item.appendChild(header)
    addOrderItems(item, order)

    const fields = make("div", "grid gap-2 sm:grid-cols-2 xl:grid-cols-4")
    const status = document.createElement("select")
    status.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    status.setAttribute("aria-label", "Etapa del pedido")
    for (const [value, label] of [["received", "Recibido"], ["preparing", "Verificando productos"], ["ready_dispatch", "Listo para entregar"], ["dispatched", "En despacho"], ["delivered", "Entregado"], ["cancelled", "Cancelado"]]) option(status, value, label, order.status || "received")
    const negotiation = document.createElement("select")
    negotiation.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    negotiation.setAttribute("aria-label", "Tipo de negociación")
    option(negotiation, "", "Tipo de negociación…", order.paymentMethod || "")
    option(negotiation, "cash", "Contado", order.paymentMethod || "")
    option(negotiation, "credit", "Crédito", order.paymentMethod || "")
    const paid = document.createElement("input")
    paid.type = "number"
    paid.min = "0"
    paid.max = String(Number(order.total || 0))
    paid.step = "0.01"
    paid.value = String(order.paidAmount || 0)
    paid.placeholder = "Abono recibido"
    paid.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    paid.setAttribute("aria-label", "Monto pagado")
    const collection = document.createElement("select")
    collection.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    collection.setAttribute("aria-label", "Estado de cobranza")
    for (const [value, label] of [["pending", "Cobro pendiente"], ["partial", "Abono parcial"], ["paid", "Pagado"], ["overdue", "Vencido"]]) option(collection, value, label, order.collectionStatus || "pending")
    const scheduled = document.createElement("input")
    scheduled.type = "datetime-local"
    scheduled.value = localDateTime(order.scheduledAt)
    scheduled.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    scheduled.setAttribute("aria-label", "Fecha y hora programada")
    const windowInput = document.createElement("input")
    windowInput.type = "text"
    windowInput.maxLength = 120
    windowInput.value = order.deliveryWindow || ""
    windowInput.placeholder = "Ventana de entrega (ej. 9:00-12:00)"
    windowInput.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    windowInput.setAttribute("aria-label", "Ventana de entrega")
    const deliveryMethod = document.createElement("select")
    deliveryMethod.className = "rounded border border-slate-300 px-2 py-2 text-sm"
    deliveryMethod.setAttribute("aria-label", "Modalidad de transporte")
    const savedDeliveryMethod = order.deliveryMethod === "moto" || order.deliveryMethod === "Moto" ? "moto" : (order.deliveryMethod === "transport" || order.deliveryMethod === "Transporte" ? "transport" : "")
    option(deliveryMethod, "", "Seleccionar transporte…", savedDeliveryMethod)
    option(deliveryMethod, "moto", "Moto", savedDeliveryMethod)
    option(deliveryMethod, "transport", "Transporte", savedDeliveryMethod)
    const notes = document.createElement("input")
    notes.type = "text"
    notes.value = order.dispatchNotes || ""
    notes.maxLength = 500
    notes.placeholder = "Notas de verificación o entrega"
    notes.className = "rounded border border-slate-300 px-2 py-2 text-sm sm:col-span-2"
    notes.setAttribute("aria-label", "Notas de pedido")
    fields.append(status, negotiation, paid, collection, scheduled, windowInput, deliveryMethod, notes)
    item.appendChild(fields)

    const actions = make("div", "flex flex-wrap items-center justify-between gap-2")
    actions.append(make("p", "text-xs text-slate-500", `Pendiente: ${money(Math.max(0, Number(order.total || 0) - Number(order.paidAmount || 0)))}`))
    const saveButton = button("Guardar seguimiento", "rounded bg-[#10165c] px-3 py-2 text-sm font-bold text-white", async () => {
      if (!negotiation.value) return setStatus("Selecciona contado o crédito antes de guardar.", actions)
      saveButton.disabled = true
      try {
        await sendJson(`/api/admin/wholesale/orders/${encodeURIComponent(order.id)}`, {
          status: status.value,
          paymentMethod: negotiation.value,
          paidAmount: paid.value,
          collectionStatus: collection.value,
          scheduledAt: scheduled.value ? new Date(scheduled.value).toISOString() : "",
          deliveryWindow: windowInput.value,
          deliveryMethod: deliveryMethod.value,
          dispatchNotes: notes.value,
          procurementItems: collectProcurementItems(item)
        }, "PATCH")
        await loadWorkflow()
      } catch (error) {
        setStatus(error.message, actions)
        saveButton.disabled = false
      }
    })
    actions.appendChild(saveButton)
    if (!["delivered", "cancelled"].includes(order.status)) {
      const programButton = button("Programar entrega", "rounded bg-emerald-700 px-3 py-2 text-sm font-bold text-white", async () => {
        if (!scheduled.value) return setStatus("Indica fecha y hora para programar la entrega.", actions)
        if (!deliveryMethod.value) return setStatus("Selecciona Moto o Transporte.", actions)
        if (!negotiation.value) return setStatus("Selecciona primero si la negociación es contado o crédito.", actions)
        const procurementItems = collectProcurementItems(item)
        if (!procurementIsResolved(procurementItems)) return setStatus("Resuelve cada producto: debe estar recibido o marcado como no requiere compra.", actions)
        programButton.disabled = true
        try {
          await sendJson(`/api/admin/wholesale/orders/${encodeURIComponent(order.id)}`, {
            status: "ready_dispatch",
            scheduledAt: new Date(scheduled.value).toISOString(),
            deliveryWindow: windowInput.value,
            deliveryMethod: deliveryMethod.value,
            procurementItems
          }, "PATCH")
          await loadWorkflow()
        } catch (error) {
          setStatus(error.message, actions)
          programButton.disabled = false
        }
      })
      actions.appendChild(programButton)
    }
    item.appendChild(actions)
    return item
  }

  function renderOrdersView() {
    orderWorkspace.replaceChildren()
    orderWorkspace.appendChild(renderDrafts())
    const panel = panelCard()
    const heading = make("div", "mb-3 flex flex-wrap items-center justify-between gap-2")
    heading.append(make("h3", "font-bold", `Pedidos recibidos (${orders.length})`))
    const filter = document.createElement("select")
    filter.className = "rounded border border-slate-300 px-2 py-1.5 text-sm"
    filter.setAttribute("aria-label", "Filtrar por tipo de negociación")
    option(filter, "", "Todos los tipos", negotiationFilterValue)
    option(filter, "cash", "Contado", negotiationFilterValue)
    option(filter, "credit", "Crédito", negotiationFilterValue)
    option(filter, "undefined", "Por definir", negotiationFilterValue)
    filter.addEventListener("change", () => {
      negotiationFilterValue = filter.value
      renderOrdersView()
    })
    heading.appendChild(filter)
    panel.appendChild(heading)
    const visibleOrders = orders.filter(order => !negotiationFilterValue || (negotiationFilterValue === "undefined" ? !order.paymentMethod : order.paymentMethod === negotiationFilterValue))
    const list = make("div", "space-y-3")
    if (!visibleOrders.length) list.append(make("p", "py-5 text-center text-sm text-slate-500", "No hay pedidos para este filtro."))
    for (const order of visibleOrders) list.appendChild(renderOrderCard(order))
    panel.appendChild(list)
    orderWorkspace.appendChild(panel)
  }

  function renderSchedule() {
    schedulePanel.replaceChildren()
    const panel = panelCard()
    panel.append(make("h2", "mb-3 text-lg font-bold", "Programación de entregas"))
    const activeOrders = orders.filter(order => !["delivered", "cancelled"].includes(order.status)).sort((a, b) => (a.scheduledAt || "9999").localeCompare(b.scheduledAt || "9999"))
    if (!activeOrders.length) panel.append(make("p", "py-5 text-center text-sm text-slate-500", "No hay pedidos pendientes de programar."))
    for (const order of activeOrders) {
      const row = make("div", "grid gap-2 border-t border-slate-200 py-3 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto] md:items-center")
      const identity = make("div", "min-w-0")
      identity.append(make("p", "font-semibold", `${order.id} · ${order.client?.name || "Cliente"}`))
      identity.append(make("p", "text-xs text-slate-500", `${paymentLabels[order.paymentMethod] || "Por definir"} · ${money(order.total)}`))
      const date = document.createElement("input")
      date.type = "datetime-local"
      date.value = localDateTime(order.scheduledAt)
      date.className = "rounded border border-slate-300 px-2 py-2 text-sm"
      date.setAttribute("aria-label", `Fecha de entrega de ${order.id}`)
      const windowInput = document.createElement("input")
      windowInput.type = "text"
      windowInput.maxLength = 120
      windowInput.value = order.deliveryWindow || ""
      windowInput.placeholder = "Ventana de entrega"
      windowInput.className = "rounded border border-slate-300 px-2 py-2 text-sm"
      const deliveryMethod = document.createElement("select")
      deliveryMethod.className = "rounded border border-slate-300 px-2 py-2 text-sm"
      deliveryMethod.setAttribute("aria-label", `Transporte de ${order.id}`)
      const savedDeliveryMethod = order.deliveryMethod === "moto" || order.deliveryMethod === "Moto" ? "moto" : (order.deliveryMethod === "transport" || order.deliveryMethod === "Transporte" ? "transport" : "")
      option(deliveryMethod, "", "Seleccionar transporte…", savedDeliveryMethod)
      option(deliveryMethod, "moto", "Moto", savedDeliveryMethod)
      option(deliveryMethod, "transport", "Transporte", savedDeliveryMethod)
      const saveButton = button("Guardar", "rounded bg-[#10165c] px-3 py-2 text-sm font-semibold text-white", async () => {
        if (!date.value) return setStatus("Indica fecha y hora para programar la entrega.", row)
        if (!deliveryMethod.value) return setStatus("Selecciona Moto o Transporte.", row)
        if (!["cash", "credit"].includes(order.paymentMethod)) return setStatus("Define contado o crédito en Pedidos antes de programar.", row)
        if ((order.items || []).some(product => !["received", "not_required"].includes(product.procurementStatus || "review"))) {
          return setStatus("Resuelve la checklist de abastecimiento desde Pedidos antes de programar.", row)
        }
        saveButton.disabled = true
        try {
          await sendJson(`/api/admin/wholesale/orders/${encodeURIComponent(order.id)}`, {
            status: "ready_dispatch",
            scheduledAt: date.value ? new Date(date.value).toISOString() : "",
            deliveryWindow: windowInput.value,
            deliveryMethod: deliveryMethod.value
          }, "PATCH")
          await loadWorkflow()
        } catch (error) {
          setStatus(error.message, row)
          saveButton.disabled = false
        }
      })
      row.append(identity, date, windowInput, deliveryMethod, saveButton)
      const methodLabel = savedDeliveryMethod === "moto" ? "Moto" : (savedDeliveryMethod === "transport" ? "Transporte" : "Sin transporte asignado")
      row.append(make("p", "text-xs text-slate-500 md:col-span-5", `Estado: ${order.status || "received"} · Programado: ${formatDate(order.scheduledAt)} · ${methodLabel}`))
      panel.appendChild(row)
    }
    schedulePanel.appendChild(panel)
  }

  function renderDashboard() {
    dashboardPanel.replaceChildren()
    const open = orders.filter(order => !["delivered", "cancelled"].includes(order.status))
    const unscheduled = open.filter(order => !order.scheduledAt).length
    const scheduled = open.filter(order => order.scheduledAt).length
    const outstanding = open.reduce((sum, order) => sum + Math.max(0, Number(order.total || 0) - Number(order.paidAmount || 0)), 0)
    const creditBalance = open.filter(order => order.paymentMethod === "credit").reduce((sum, order) => sum + Math.max(0, Number(order.total || 0) - Number(order.paidAmount || 0)), 0)
    const procurementItems = open.flatMap(order => order.items || []).map(product => ({ ...product, procurementStatus: product.procurementStatus || "review" }))
    const procurementOpen = procurementItems.filter(product => !["received", "not_required"].includes(product.procurementStatus))
    const supplierPending = procurementItems.filter(product => ["supplier_needed", "requested"].includes(product.procurementStatus))
    const metrics = [
      ["Solicitudes sin confirmar", drafts.length],
      ["Pedidos abiertos", open.length],
      ["Por programar", unscheduled],
      ["Programados", scheduled],
      ["Por cobrar", money(outstanding)],
      ["Saldo a crédito", money(creditBalance)],
      ["Productos por resolver", procurementOpen.length],
      ["Pendientes del proveedor", supplierPending.length]
    ]
    const grid = make("div", "grid gap-3 sm:grid-cols-2 xl:grid-cols-3")
    for (const [label, value] of metrics) {
      const metric = panelCard()
      metric.append(make("p", "text-sm text-slate-500", label), make("p", "mt-2 text-2xl font-bold text-[#10165c]", value))
      grid.appendChild(metric)
    }
    dashboardPanel.appendChild(grid)
    const breakdown = panelCard()
    breakdown.append(make("h2", "mb-3 text-lg font-bold", "Pedidos por negociación"))
    for (const type of ["cash", "credit", "undefined"]) {
      const matching = orders.filter(order => type === "undefined" ? !order.paymentMethod : order.paymentMethod === type)
      const amount = matching.reduce((sum, order) => sum + Number(order.total || 0), 0)
      breakdown.append(make("p", "border-t border-slate-100 py-2 text-sm", `${paymentLabels[type] || "Por definir"}: ${matching.length} pedidos · ${money(amount)}`))
    }
    dashboardPanel.appendChild(breakdown)
  }

  function renderActivity() {
    const target = activitySection.querySelector("#activity")
    if (!target) return
    target.replaceChildren()
    if (!activity.length) return target.appendChild(make("p", "py-4 text-slate-400", "Sin actividad mayorista registrada."))
    for (const event of activity) {
      const row = make("div", "flex flex-wrap justify-between gap-2 py-3")
      row.append(make("span", "font-medium", String(event.type || "Actividad").replace("wholesale_", "")))
      row.append(make("span", "text-slate-500", `${event.email || "-"} · ${formatDate(event.createdAt)}`))
      target.appendChild(row)
    }
  }

  async function loadWorkflow() {
    try {
      const orderData = await getJson("/api/admin/wholesale/orders")
      orders = orderData.orders || []
      try {
        const inboxData = await getJson("/api/admin/wholesale/inbox")
        drafts = inboxData.drafts || []
      } catch (error) {
        drafts = []
        console.error("Error cargando la bandeja mayorista:", error)
      }
      try {
        const activityData = await getJson("/api/admin/wholesale/activity")
        activity = activityData.activity || []
      } catch (error) {
        activity = []
        console.error("Error cargando actividad mayorista:", error)
      }
      renderActivity()
      if (activeTab === "orders") renderOrdersView()
      if (activeTab === "schedule") renderSchedule()
      if (activeTab === "dashboard") renderDashboard()
    } catch (error) {
      console.error("Error cargando el flujo mayorista:", error)
      orderWorkspace.replaceChildren(make("p", "rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700", error.message))
    }
  }

  const accessSection = main.firstElementChild
  if (accessSection) accessSection.insertAdjacentElement("afterend", nav)
  setActiveTab("orders")
  loadWorkflow()
})()
