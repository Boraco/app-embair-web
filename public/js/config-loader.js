(async function applySiteConfig() {
    try {
        const res = await fetch("/api/config")
        if (!res.ok) return
        const data = await res.json()
        
        // 0. SEO & Metadata
        const isHome = window.location.pathname === "/" || window.location.pathname.endsWith("/index.html") || window.location.pathname.endsWith("/landing.html")

        if (isHome && data.seoTitle) {
            document.title = data.seoTitle
        } else if (data.storeName) {
            if (isHome) {
                document.title = data.storeName
            } else {
                 if (!document.title.includes(data.storeName)) {
                     document.title = `${document.title} | ${data.storeName}`
                 }
            }
        }

        if (data.seoDescription) {
            let metaDesc = document.querySelector('meta[name="description"]')
            if (!metaDesc) {
                metaDesc = document.createElement('meta')
                metaDesc.name = 'description'
                document.head.appendChild(metaDesc)
            }
            metaDesc.content = data.seoDescription
        }

        if (data.seoFavicon) {
            let linkIcon = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]')
            if (!linkIcon) {
                linkIcon = document.createElement('link')
                linkIcon.rel = 'icon'
                document.head.appendChild(linkIcon)
            }
            linkIcon.href = data.seoFavicon
        }

        if (data.seoOgImage) {
             let metaOg = document.querySelector('meta[property="og:image"]')
            if (!metaOg) {
                metaOg = document.createElement('meta')
                metaOg.setAttribute('property', 'og:image')
                document.head.appendChild(metaOg)
            }
            metaOg.content = data.seoOgImage
        }
        
        
        // 1. Identity & Texts
        if (data.storeName) {
            const storeNameEls = document.querySelectorAll(".store-name")
            storeNameEls.forEach(el => el.textContent = data.storeName)
        }
        
        // Context
        // FIX: "/" is Landing Page, so it is NOT Portal. Portal is /app or index.html
        const isPortalPage = window.location.pathname.includes("/app") || window.location.pathname.endsWith("index.html") || window.location.pathname.includes("/producto/")

        if (isPortalPage) {
            if (data.portalHeroTitle) {
                const heroTitle = document.getElementById("hero-title") || document.querySelector("#hero h1, #hero h2")
                if (heroTitle) heroTitle.textContent = data.portalHeroTitle
            }
            if (data.portalHeroSubtitle) {
                const heroSubtitle = document.getElementById("hero-subtitle") || document.querySelector("#hero p")
                if (heroSubtitle) heroSubtitle.textContent = data.portalHeroSubtitle
            }
        } else {
            if (data.heroTitle) {
                const heroTitle = document.getElementById("hero-title") || document.querySelector("#hero h1, #hero h2")
                if (heroTitle) heroTitle.textContent = data.heroTitle
            }
            if (data.heroSubtitle) {
                const heroSubtitle = document.getElementById("hero-subtitle") || document.querySelector("#hero p")
                if (heroSubtitle) heroSubtitle.textContent = data.heroSubtitle
            }
        }
        
        
        if (data.whatsapp) {
            const waNumber = data.whatsapp.replace(/\D/g, "")
            
            // Update specific CTA buttons
            const ctaWa = document.getElementById("cta-wa")
            if (ctaWa) ctaWa.href = `https://wa.me/${waNumber}`
            
            // Update mobile nav WA link
            const mobileWa = document.querySelector("#mobile-nav a[href^='https://wa.me']")
            if (mobileWa) mobileWa.href = `https://wa.me/${waNumber}`
            
            // Update landing page WA buttons if they exist
            const landingWa = document.querySelectorAll("a[href^='https://wa.me']")
            landingWa.forEach(el => {
                // Preserve existing text/body params if possible, or just update number
                const currentHref = el.getAttribute("href")
                if (currentHref && currentHref.includes("?")) {
                    const params = currentHref.split("?")[1]
                    el.href = `https://wa.me/${waNumber}?${params}`
                } else {
                    el.href = `https://wa.me/${waNumber}`
                }
            })

            // Update footer phone text
            const footerPhone = document.querySelector(".footer-phone")
            if (footerPhone) footerPhone.textContent = `+${waNumber}`
        }
        
        /*
        if (data.logoUrl) {
            const logoImg = document.getElementById("app-logo")
            const logoFallback = document.getElementById("app-logo-fallback")
            const logoText = document.getElementById("app-logo-text")
            
            if (logoImg) {
                logoImg.src = data.logoUrl
                logoImg.classList.remove("hidden")
                if (logoFallback) logoFallback.classList.add("hidden")
                if (logoText) logoText.classList.add("hidden") // Hide text if logo image is present
            }
        }
        */
        
        // 2. Appearance (Colors)
        if (data.primaryColor || data.secondaryColor) {
            const primary = data.primaryColor || "#4f46e5"
            const secondary = data.secondaryColor || "#0ea5e9"
            
            // Check if style already exists
            let style = document.getElementById("dynamic-theme-style")
            if (!style) {
                style = document.createElement("style")
                style.id = "dynamic-theme-style"
                document.head.appendChild(style)
            }
            
            style.innerHTML = `
                :root {
                    --primary-color: ${primary};
                    --secondary-color: ${secondary};
                }
                
                /* Common Backgrounds */
                .bg-primary, .bg-blue-700, .bg-blue-600, .bg-blue-500, .bg-embair-blue {
                    background-color: var(--primary-color) !important;
                }
                .bg-secondary, .bg-embair-orange {
                    background-color: var(--secondary-color) !important;
                }
                
                /* Hover States */
                .hover\\:bg-blue-700:hover, .hover\\:bg-primary:hover {
                    background-color: var(--primary-color) !important;
                    filter: brightness(0.9);
                }
                
                /* Text Colors */
                .text-primary, .text-blue-600, .text-blue-700, .text-blue-900, .text-embair-blue {
                    color: var(--primary-color) !important;
                }
                .text-secondary, .text-embair-orange {
                    color: var(--secondary-color) !important;
                }
                
                /* Borders */
                .border-primary, .border-blue-600, .border-embair-blue {
                    border-color: var(--primary-color) !important;
                }
                .border-secondary, .border-embair-orange {
                    border-color: var(--secondary-color) !important;
                }
                
                /* Gradients */
                .bg-gradient-primary {
                    background: linear-gradient(to right, var(--primary-color), var(--secondary-color)) !important;
                }
                
                /* Specific Overrides for Landing/Index */
                #hero > div, header .bg-gradient-to-br {
                    background: linear-gradient(to right, var(--primary-color), var(--secondary-color)) !important;
                }
                
                /* Active Filter Chip */
                .filter-chip.active {
                    background-color: var(--primary-color) !important;
                    border-color: var(--primary-color) !important;
                }
            `
        }

        
        // 3. Carousel/Slider
        const isPortal = window.location.pathname.includes("/app") || window.location.pathname.endsWith("index.html") || window.location.pathname.includes("/producto/")
        
        // Determine which slides to use
        let slidesToUse = data.slides || []
        if (isPortal) {
            if (data.portalSlides && data.portalSlides.length > 0) {
                slidesToUse = data.portalSlides
            } else if (data.useLandingSlidesOnPortal) {
                slidesToUse = data.slides || []
            } else {
                slidesToUse = [] // Don't touch portal slider (keep products)
            }
        } else {
            // Landing Page
            slidesToUse = data.slides || []
        }

        if (slidesToUse && slidesToUse.length > 0) {
            const sliderContainer = document.getElementById("hero-slider")
            const indicatorsContainer = document.getElementById("hero-indicators")
            
            if (sliderContainer) {
                sliderContainer.innerHTML = ""
                if (indicatorsContainer) indicatorsContainer.innerHTML = ""
                
                let currentSlide = 0
                const showSlide = (n) => {
                    const slides = Array.from(sliderContainer.children)
                    const dots = indicatorsContainer ? indicatorsContainer.querySelectorAll("button") : []
                    
                    slides.forEach((slide, i) => {
                        // Toggle opacity on the wrapper div
                        if (i === n) {
                            slide.classList.remove("opacity-0", "z-0")
                            slide.classList.add("opacity-100", "z-10")
                        } else {
                            slide.classList.remove("opacity-100", "z-10")
                            slide.classList.add("opacity-0", "z-0")
                        }
                    })
                    
                    dots.forEach((dot, i) => {
                        if (i === n) {
                            dot.className = "w-6 h-2 rounded-full bg-white transition-all"
                        } else {
                            dot.className = "w-2 h-2 rounded-full bg-white/50 hover:bg-white/80 transition-all"
                        }
                    })
                    currentSlide = n
                }

                slidesToUse.forEach((slide, index) => {
                    // Create Slide Wrapper
                    const slideDiv = document.createElement("div")
                    slideDiv.className = `absolute inset-0 w-full h-full transition-opacity duration-1000 ${index === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0'}`
                    
                    // Image
                    const img = document.createElement("img")
                    img.src = slide.image || slide.img
                    img.alt = slide.title || `Slide ${index + 1}`
                    img.className = "w-full h-full object-cover"
                    slideDiv.appendChild(img)

                    // Overlay Text (Optional)
                    if (slide.title || slide.subtitle) {
                        const overlay = document.createElement("div")
                        // Changed to bottom gradient caption for better visibility and less obstruction
                        overlay.className = "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-12 pb-6 px-6 flex flex-col justify-end text-left"
                        overlay.innerHTML = `
                            ${slide.title ? `<h3 class="text-xl md:text-3xl font-bold text-white mb-1 drop-shadow-md">${slide.title}</h3>` : ''}
                            ${slide.subtitle ? `<p class="text-sm md:text-lg text-white/90 drop-shadow-sm line-clamp-2">${slide.subtitle}</p>` : ''}
                            ${slide.link ? `<div class="mt-3"><a href="${slide.link}" class="inline-block bg-embair-orange text-white text-xs md:text-sm px-4 py-2 rounded-full font-bold hover:bg-orange-600 transition shadow-lg">Ver más</a></div>` : ''}
                        `
                        slideDiv.appendChild(overlay)
                    }

                    sliderContainer.appendChild(slideDiv)
                    
                    // Create Indicator
                    if (slidesToUse.length > 1 && indicatorsContainer) {
                        const dot = document.createElement("button")
                        dot.className = `w-2 h-2 rounded-full transition-all ${index === 0 ? 'bg-white w-6' : 'bg-white/50 hover:bg-white/80'}`
                        dot.onclick = () => showSlide(index)
                        indicatorsContainer.appendChild(dot)
                    }
                })

                // Auto-play logic
                if (slidesToUse.length > 1) {
                    setInterval(() => {
                        let next = currentSlide + 1
                        if (next >= slidesToUse.length) next = 0
                        showSlide(next)
                    }, 5000)
                }
            }
        }
        

        // 3.5 Marquee (Cintillo)
        if (data.marqueeText && data.marqueeEnabled) {
            const marqueeContainer = document.getElementById("marquee-container")
            if (marqueeContainer) {
                marqueeContainer.classList.remove("hidden")
                // Apply custom colors if set
                const bg = data.marqueeBgColor || "#0f172a" // slate-900
                const text = data.marqueeTextColor || "#ffffff"
                marqueeContainer.style.backgroundColor = bg
                marqueeContainer.style.color = text
                
                // Create marquee content
                // Simple CSS animation
                const styleId = "marquee-style"
                if (!document.getElementById(styleId)) {
                    const s = document.createElement("style")
                    s.id = styleId
                    s.innerHTML = `
                        @keyframes marquee {
                            0% { transform: translateX(100%); }
                            100% { transform: translateX(-100%); }
                        }
                        .marquee-content {
                            display: inline-block;
                            white-space: nowrap;
                            animation: marquee ${data.marqueeSpeed || 20}s linear infinite;
                            padding-left: 100%; /* Start off-screen */
                        }
                        .marquee-wrapper {
                            overflow: hidden;
                            width: 100%;
                            display: flex;
                        }
                    `
                    document.head.appendChild(s)
                }
                
                const linkStart = data.marqueeLink ? `<a href="${data.marqueeLink}" class="hover:underline">` : ""
                const linkEnd = data.marqueeLink ? `</a>` : ""
                
                marqueeContainer.innerHTML = `
                    <div class="marquee-wrapper">
                        <div class="marquee-content font-semibold text-sm md:text-base">
                            ${linkStart}${data.marqueeText}${linkEnd}
                        </div>
                    </div>
                `
            }
        }

        // 4. Dynamic Sections (Only on Landing Page)
        if (!isPortalPage && data.sections && data.sections.length > 0) {
            const sectionsContainer = document.getElementById("dynamic-sections")
            if (sectionsContainer) {
                sectionsContainer.innerHTML = ""
                
                data.sections.forEach(section => {
                    const sectionEl = document.createElement("section")
                    sectionEl.className = "py-8 md:py-12"
                    
                    const formatText = (text) => (text || "").replace(/\n/g, "<br>")
                    let contentHtml = ""
                    
                    // Determine Layout
                    let layout = section.layout
                    if (section.type === "image-text") {
                         // Map editor values to loader values
                         if (layout === "left") layout = "image_text" // Image Left
                         else if (layout === "right") layout = "text_image" // Image Right (Text Left)
                    } else if (section.type === "text") {
                        layout = "text_only"
                    }

                    if (layout === "text_image") {
                        contentHtml = `
                            <div class="grid md:grid-cols-2 gap-8 items-center">
                                <div class="order-2 md:order-1">
                                    <h3 class="text-2xl md:text-3xl font-bold mb-4 text-slate-800">${section.title || ""}</h3>
                                    <div class="text-slate-600 leading-relaxed mb-6">${formatText(section.content)}</div>
                                    ${section.link ? `<a href="${section.link}" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition">Ver más</a>` : ""}
                                </div>
                                <div class="order-1 md:order-2 h-64 md:h-80 rounded-2xl overflow-hidden shadow-lg bg-slate-100">
                                    ${section.image || section.img ? `<img src="${section.image || section.img}" alt="${section.title}" class="w-full h-full object-cover">` : '<div class="flex items-center justify-center h-full text-slate-400">Sin imagen</div>'}
                                </div>
                            </div>
                        `
                    } else if (layout === "image_text") {
                        contentHtml = `
                            <div class="grid md:grid-cols-2 gap-8 items-center">
                                <div class="h-64 md:h-80 rounded-2xl overflow-hidden shadow-lg bg-slate-100">
                                    ${section.image || section.img ? `<img src="${section.image || section.img}" alt="${section.title}" class="w-full h-full object-cover">` : '<div class="flex items-center justify-center h-full text-slate-400">Sin imagen</div>'}
                                </div>
                                <div>
                                    <h3 class="text-2xl md:text-3xl font-bold mb-4 text-slate-800">${section.title || ""}</h3>
                                    <div class="text-slate-600 leading-relaxed mb-6">${formatText(section.content)}</div>
                                    ${section.link ? `<a href="${section.link}" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition">Ver más</a>` : ""}
                                </div>
                            </div>
                        `
                    } else if (layout === "full_width") {
                        contentHtml = `
                            <div class="relative rounded-2xl overflow-hidden shadow-xl h-80 md:h-96 group">
                                ${section.image || section.img ? `<img src="${section.image || section.img}" alt="${section.title}" class="absolute inset-0 w-full h-full object-cover brightness-50 group-hover:scale-105 transition-transform duration-700">` : '<div class="absolute inset-0 bg-slate-800"></div>'}
                                <div class="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-white">
                                    <h3 class="text-3xl md:text-4xl font-bold mb-4 drop-shadow-md">${section.title || ""}</h3>
                                    <div class="text-lg md:text-xl max-w-2xl drop-shadow-sm mb-8 opacity-90">${formatText(section.content)}</div>
                                    ${section.link ? `<a href="${section.link}" class="bg-white text-blue-900 px-8 py-3 rounded-full font-bold hover:bg-blue-50 transition shadow-lg">Más información</a>` : ""}
                                </div>
                            </div>
                        `
                    } else if (layout === "text_only") {
                         contentHtml = `
                            <div class="max-w-4xl mx-auto text-center">
                                <h3 class="text-2xl md:text-3xl font-bold mb-4 text-slate-800">${section.title || ""}</h3>
                                <div class="text-slate-600 leading-relaxed text-lg">${formatText(section.content)}</div>
                            </div>
                        `
                    }
                    
                    sectionEl.innerHTML = contentHtml
                    sectionsContainer.appendChild(sectionEl)
                })
            }
        }
        
        // 5. Footer & Contact
        if (data.address) {
            const addressEl = document.getElementById("footer-address")
            if (addressEl) addressEl.textContent = data.address
        }
        if (data.phone) {
            const phoneEl = document.getElementById("footer-phone")
            if (phoneEl) {
                phoneEl.textContent = data.phone
                phoneEl.href = `tel:${data.phone.replace(/[^\d+]/g, "")}`
            }
        }
        if (data.email) {
            const emailEl = document.getElementById("footer-email")
            if (emailEl) emailEl.textContent = data.email
        }
        if (data.mapUrl) {
            const mapEl = document.getElementById("footer-map-iframe")
            if (mapEl) mapEl.src = data.mapUrl
        }

        // 5.5 Services (Portal)
        if (data.services && data.services.length > 0) {
            const servicesSection = document.getElementById("servicios")
            if (servicesSection) {
                // Update Title
                const titleEl = servicesSection.querySelector("h3")
                if (titleEl && data.servicesTitle) titleEl.textContent = data.servicesTitle
                
                // Update Grid
                const grid = servicesSection.querySelector(".grid")
                if (grid) {
                    grid.innerHTML = ""
                    data.services.forEach(s => {
                        const card = document.createElement("div")
                        card.className = "bg-white rounded-lg shadow p-5 hover:shadow-md transition h-full flex flex-col"
                        card.innerHTML = `
                            <div class="text-lg font-bold mb-2 text-slate-800 uppercase tracking-wide border-b border-slate-100 pb-2">${s.title || ""}</div>
                            <div class="text-gray-600 mb-4 text-sm flex-grow leading-relaxed">${s.desc || ""}</div>
                            ${s.link ? 
                                `<a href="${s.link}" class="text-blue-600 font-bold text-sm hover:text-blue-800 transition block mt-auto uppercase tracking-wider flex items-center gap-1">${s.cta || "Ver más"} <span>→</span></a>` : 
                                `<div class="text-blue-600 font-bold text-sm mt-auto uppercase tracking-wider">${s.cta || ""}</div>`
                            }
                        `
                        grid.appendChild(card)
                    })
                }
            }
        }

        // 6. Analytics & Tracking
        window.trackEvent = async function(type, meta = {}) {
            try {
                await fetch("/api/events", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type, meta })
                })
            } catch (e) {
                console.error("Tracking error:", e)
            }
        }
        
        // Auto-track visit
        if (!sessionStorage.getItem("visit_tracked")) {
            window.trackEvent("landing_visit", { path: window.location.pathname })
            sessionStorage.setItem("visit_tracked", "true")
        }

    } catch (e) {
        console.error("Error applying site config", e)
    }
})()
