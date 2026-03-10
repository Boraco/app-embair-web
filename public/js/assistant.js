
// AI Assistant Logic & Shared Helpers
// Depends on window.PRODUCTS being populated by the main app

// Expose the Assistant object globally
window.Assistant = {
  config: { prompt: "", synonyms: [] },
  state: {
    lastQuery: "",
    pending: "",
    // Lead generation state (optional)
    lead: {
      name: "",
      contact: "",
      segment: "",
      zone: "",
      need: "",
      source: "",
      stage: "welcome",
      sentClient: false
    }
  },
  
  // Default elements
  elements: {
    root: document.getElementById("assistant-root"),
    panel: document.getElementById("assistant-panel"),
    toggle: document.getElementById("assistant-toggle"),
    close: document.getElementById("assistant-close"),
    messages: document.getElementById("assistant-messages"),
    input: document.getElementById("assistant-input"),
    send: document.getElementById("assistant-send")
  },

  init: async function(options = {}) {
    this.options = options
    
    // Update elements if provided
    if (options.elements) Object.assign(this.elements, options.elements)

    // Load config
    await this.loadConfig()

    // Attach listeners
    if (this.elements.toggle) {
      this.elements.toggle.addEventListener("click", () => this.open())
    }
    if (this.elements.close) {
      this.elements.close.addEventListener("click", () => this.close())
    }
    if (this.elements.send) {
      this.elements.send.addEventListener("click", () => this.handleInput())
    }
    if (this.elements.input) {
      this.elements.input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          this.handleInput()
        }
      })
    }
    
    // Custom init logic
    if (options.onInit) options.onInit(this)
  },

  open: function() {
    if (this.elements.panel) this.elements.panel.classList.remove("hidden")
    if (this.elements.toggle) this.elements.toggle.classList.add("hidden")
    
    // Welcome message
    if (this.elements.messages && !this.elements.messages.dataset.init) {
      const prompt = this.config.prompt || "Hola, soy tu asistente de compras. Cuéntame qué necesitas y buscaré en el catálogo los productos adecuados."
      this.addMessage("bot", prompt)
      this.elements.messages.dataset.init = "1"
    }
    if (this.elements.input) this.elements.input.focus()
  },

  close: function() {
    if (this.elements.panel) this.elements.panel.classList.add("hidden")
    if (this.elements.toggle) this.elements.toggle.classList.remove("hidden")
  },

  loadConfig: async function() {
    try {
      const res = await fetch("/api/ia/config")
      const data = await res.json()
      if (data) this.config = data
    } catch (e) { console.error("Error loading IA config", e) }
  },

  // Nueva función para consultar al cerebro central (mismo que WhatsApp)
  askServer: async function(text) {
    try {
      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      })
      return await res.json()
    } catch (e) {
      console.error("Error asking server:", e)
      return { type: "error" }
    }
  },

  normalizeText: function(text) {
    let s = (text || "").toLowerCase()
    // Common electrical/hardware corrections
    s = s.replace(/\binterrutptor\b/g, "interruptor")
       .replace(/\binterrutor\b/g, "interruptor")
       .replace(/\binteruptor\b/g, "interruptor")
       .replace(/\bint[ea]rruptor\b/g, "interruptor")
       
    // Synonyms from config
    if (this.config.synonyms && Array.isArray(this.config.synonyms)) {
      for (const syn of this.config.synonyms) {
        if (syn.key && syn.value) {
          const regex = new RegExp(`\\b${syn.key}\\b`, "gi")
          s = s.replace(regex, syn.value)
        }
      }
    }
    return s
  },

  handleInput: async function() {
    if (!this.elements.input) return
    const text = this.elements.input.value.trim()
    if (!text) return
    
    this.elements.input.value = ""
    this.addMessage("user", text)
    this.state.lastQuery = text

    // 1. Check custom handler (landing page logic, etc)
    if (this.options.customHandler) {
      const handled = await this.options.customHandler(text, this)
      if (handled !== false) return // If handler returns false, continue to default logic
    }

    // 2. Check FAQs first
    const faqs = this.config.faqs || []
    const lowerText = text.toLowerCase()
    const bestFaq = faqs.find(f => lowerText.includes(f.question.toLowerCase()))
    
    if (bestFaq) {
      this.addMessage("bot", bestFaq.answer)
      return
    }

    // 3. Default logic
    this.processQuery(text)
  },

  processQuery: function(text) {
    const norm = this.normalizeText(text)
    
    // Stock Check Logic
    if (/disponible|tienes|tienen|hay|stock/.test(norm)) {
      const prod = this.findBestProductMatch(text)
      if (prod) {
        if (prod.available && prod.available !== "Disponible") {
           this.addMessage("bot", `Ese producto figura como agotado: ${prod.name}. Te sugiero estas alternativas:`)
           const recs = this.recommendProducts(prod.category + " " + (prod.subcategory||""))
           recs.forEach(p => this.addProductCard(p))
        } else {
           this.addMessage("bot", `Sí, está disponible: ${prod.name}. Puedes agregarlo al carrito.`)
           this.addProductCard(prod)
        }
        return
      }
    }

    // General Recommendation
    const recs = this.recommendProducts(text)
    if (!recs.length) {
      this.addMessage("bot", "No encontré productos específicos para esa búsqueda. Intenta describir el uso o la categoría (ej: iluminación, tubería).")
      return
    }
    
    this.addMessage("bot", "Aquí tienes algunas opciones disponibles:")
    recs.forEach(p => this.addProductCard(p))
    
    // Log interaction
    this.logInteraction(text, recs.map(r => r.id))
  },

  findBestProductMatch: function(text) {
    const q = this.normalizeText(text)
    const list = (window.PRODUCTS && Array.isArray(window.PRODUCTS)) ? window.PRODUCTS : []
    let best = null
    let bestScore = 0
    
    const words = q.split(/\s+/).filter(Boolean)
    
    for (const p of list) {
      const name = (p.name || "").toLowerCase()
      const hay = `${p.name || ""} ${p.desc || ""}`.toLowerCase()
      let score = 0
      
      for (const w of words) {
        if (!w) continue
        if (name.includes(w)) score += 3
        if (hay.includes(w)) score += 1
      }
      
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return bestScore > 0 ? best : null
  },

  recommendProducts: function(query) {
    const q = this.normalizeText(query)
    const words = q.split(/\s+/).filter(Boolean)
    const list = (window.PRODUCTS && Array.isArray(window.PRODUCTS)) ? window.PRODUCTS : []
    const filtered = []

    for (const p of list) {
      // Basic availability check (can be overridden)
      if (p.available && p.available !== "Disponible") continue

      const hay = `${p.name || ""} ${p.desc || ""} ${p.category || ""} ${p.subcategory || ""} ${p.material || ""} ${p.brand || ""}`.toLowerCase()
      let score = 0
      
      if (!words.length) score += 1
      
      for (const w of words) {
        if (hay.includes(w)) score += 3
      }
      
      // Boosters
      if (/lámpara|iluminación|foco|bombillo/.test(q) && p.category === "Electricidad") score += 4
      if (/tubo|agua|llave|grifo|grifería|sifón/.test(q) && p.category === "Plomería") score += 4
      if (p.price != null) score += Math.min(Number(p.price) / 1000, 5)

      if (score > 0) filtered.push({ p, score })
    }
    
    filtered.sort((a, b) => b.score - a.score)
    return filtered.slice(0, 4).map(x => x.p)
  },

  addMessage: function(sender, text) {
    if (!this.elements.messages) return
    const wrap = document.createElement("div")
    wrap.className = "flex " + (sender === "user" ? "justify-end" : "justify-start")
    
    const bubble = document.createElement("div")
    // Blue for user, White for bot (matching admin palette)
    bubble.className = (sender === "user"
      ? "px-3 py-2 rounded-lg text-sm max-w-[85%] bg-blue-600 text-white rounded-br-none"
      : "px-3 py-2 rounded-lg text-sm max-w-[85%] bg-white text-slate-800 border border-slate-200 rounded-bl-none shadow-sm")
      
    bubble.textContent = text
    wrap.appendChild(bubble)
    this.elements.messages.appendChild(wrap)
    this.elements.messages.scrollTop = this.elements.messages.scrollHeight
  },

  addProductCard: function(p) {
    if (!this.elements.messages) return
    const row = document.createElement("div")
    row.className = "flex gap-3 bg-white border border-slate-200 rounded-xl p-3 text-xs mb-2 shadow-sm"
    
    // Image
    const imgWrap = document.createElement("div")
    imgWrap.className = "w-14 h-14 rounded-md overflow-hidden bg-slate-100 flex-shrink-0"
    if (p.img) {
      const img = document.createElement("img")
      img.src = p.img
      img.alt = p.name
      img.className = "w-full h-full object-cover"
      imgWrap.appendChild(img)
    } else {
      imgWrap.className += " flex items-center justify-center text-[10px] text-slate-400"
      imgWrap.textContent = "Sin foto"
    }

    // Info
    const info = document.createElement("div")
    info.className = "flex-1 min-w-0"
    
    const title = document.createElement("div")
    title.className = "font-semibold text-slate-900 truncate"
    title.textContent = p.name
    
    const meta = document.createElement("div")
    meta.className = "text-[11px] text-slate-500 truncate"
    meta.textContent = [p.category, p.subcategory].filter(Boolean).join(" • ")
    
    const price = document.createElement("div")
    price.className = "text-blue-700 font-bold mt-1"
    price.textContent = p.price ? `$${Number(p.price).toLocaleString()}` : "Cotizar"

    info.appendChild(title)
    info.appendChild(meta)
    info.appendChild(price)
    
    // Action (Add to cart if available)
    if (window.addToCart) {
        const btn = document.createElement("button")
        btn.className = "mt-2 bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-full text-[10px] font-medium transition"
        btn.textContent = "Agregar"
        btn.addEventListener("click", () => window.addToCart(p, 1))
        info.appendChild(btn)
    }

    row.appendChild(imgWrap)
    row.appendChild(info)
    
    this.elements.messages.appendChild(row)
    this.elements.messages.scrollTop = this.elements.messages.scrollHeight
  },

  logInteraction: function(query, productIds) {
    try {
      const logs = JSON.parse(localStorage.getItem("assistantLogs") || "[]")
      logs.push({ ts: Date.now(), query, productIds })
      localStorage.setItem("assistantLogs", JSON.stringify(logs))
    } catch {}
  }
}

// Auto-init if standard structure is present and no manual init expected
// We check for a flag or just wait for DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    // If specific elements exist and no custom init script is running yet
    if (document.getElementById("assistant-root") && !window.ASSISTANT_MANUAL_INIT) {
        // Simple init for pages that don't need custom logic
        window.Assistant.init()
    }
})
