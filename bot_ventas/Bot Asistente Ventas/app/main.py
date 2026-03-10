from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .api import inventory, ml_accounts, ml_auth, chat, ai
from .database import Base, engine


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Bot Asistente de Ventas")

app.include_router(ml_auth.router)
app.include_router(ml_accounts.router)
app.include_router(inventory.router)
app.include_router(chat.router)
app.include_router(ai.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def dashboard():
    return """
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bot Asistente de Ventas</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            body { background-color: #f8f9fa; }
            .sidebar { height: 100vh; background-color: #ffffff; padding: 20px; box-shadow: 2px 0 5px rgba(0,0,0,0.05); position: fixed; width: 250px; }
            .sidebar h3 { color: #000080; font-weight: bold; margin-bottom: 30px; font-size: 1.5rem; }
            .nav-link { color: #6c757d; font-weight: 500; padding: 10px 15px; border-radius: 8px; margin-bottom: 5px; cursor: pointer; }
            .nav-link:hover, .nav-link.active { background-color: #e9ecef; color: #000080; }
            .nav-link i { margin-right: 10px; width: 20px; text-align: center; }
            .main-content { margin-left: 250px; padding: 30px; max-width: 1600px; }
            .card { border: none; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); transition: transform 0.2s; margin-bottom: 20px; }
            .card:hover { transform: translateY(-5px); }
            .stat-card { background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); }
            .stat-icon { font-size: 2rem; color: #000080; margin-bottom: 15px; }
            .btn-primary { background-color: #000080; border-color: #000080; }
            .btn-primary:hover { background-color: #000060; border-color: #000060; }
            .section-content { display: none; }
            .section-content.active { display: block; }
            
            /* Kanban Styles */
            .kanban-board { display: flex; gap: 20px; overflow-x: auto; padding-bottom: 20px; }
            .kanban-column { min-width: 280px; background: #f1f3f5; border-radius: 8px; padding: 15px; flex: 0 0 auto; }
            .kanban-header { font-weight: bold; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
            .kanban-card { background: white; padding: 15px; border-radius: 6px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; }
            .kanban-card:hover { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .priority-high { border-left: 4px solid #dc3545; }
            .priority-medium { border-left: 4px solid #ffc107; }
            .priority-low { border-left: 4px solid #0d6efd; }
            
            /* Chat Styles */
            .chat-container { display: flex; height: calc(100vh - 100px); background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            .chat-list { width: 300px; border-right: 1px solid #dee2e6; overflow-y: auto; }
            .chat-item { padding: 15px; border-bottom: 1px solid #f1f1f1; cursor: pointer; }
            .chat-item:hover, .chat-item.active { background-color: #f8f9fa; }
            .chat-main { flex: 1; display: flex; flex-direction: column; }
            .chat-header { padding: 15px; border-bottom: 1px solid #dee2e6; font-weight: bold; }
            .chat-messages { flex: 1; padding: 20px; overflow-y: auto; background-color: #f8f9fa; }
            .message { margin-bottom: 15px; max-width: 70%; padding: 10px 15px; border-radius: 15px; }
            .message.received { background-color: white; align-self: flex-start; border-bottom-left-radius: 5px; }
            .message.sent { background-color: #dcf8c6; align-self: flex-end; margin-left: auto; border-bottom-right-radius: 5px; }
            .chat-input { padding: 15px; border-top: 1px solid #dee2e6; display: flex; gap: 10px; }

            /* Metrics Styles */
            .metrics { display: flex; gap: 20px; margin-top: 20px; margin-bottom: 20px; }
            .metric { background: white; padding: 15px; border-radius: 8px; flex: 1; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
            .metric-label { font-size: 0.9rem; color: #6c757d; }
            .metric-value { font-size: 1.5rem; font-weight: bold; color: #000080; }
            .metric-hint { font-size: 0.8rem; color: #adb5bd; }
            .status-pill { padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 500; }
            .status-pill.error { background-color: #ffebee; color: #c62828; }
            .status-pill.ok { background-color: #e8f5e9; color: #2e7d32; }
        </style>
    </head>
    <body>
        <div class="container-fluid">
            <div class="row">
                <!-- Sidebar -->
                <div class="col-md-2 sidebar d-none d-md-block">
                    <h3><i class="fas fa-robot me-2"></i>Bot Asistente</h3>
                    <nav class="nav flex-column">
                        <a class="nav-link active" onclick="showSection('dashboard')"><i class="fas fa-home"></i> Dashboard</a>
                        <a class="nav-link" onclick="showSection('inbox')"><i class="fas fa-inbox"></i> Bandeja de Entrada</a>
                        <a class="nav-link" onclick="showSection('kanban')"><i class="fas fa-columns"></i> Tablero Kanban</a>
                        <a class="nav-link" onclick="showSection('inventory')"><i class="fas fa-boxes"></i> Inventario</a>
                        <a class="nav-link" onclick="showSection('settings')"><i class="fas fa-cog"></i> Configuración</a>
                    </nav>
                    <div class="mt-4 p-3 bg-light rounded">
                        <small class="text-muted d-block mb-2">Estado del Sistema</small>
                        <div class="d-flex align-items-center mb-2">
                            <div id="status-pill" class="status-pill ok me-2">●</div>
                            <span id="status-text">Online</span>
                        </div>
                        <small id="ml-account-name" class="text-muted" style="font-size: 0.75rem">Cuenta: ...</small>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="main-content">
                    <!-- Dashboard Section -->
                    <div id="dashboard" class="section-content active">
                        <h2>Dashboard General</h2>
                        
                        <!-- Metrics from Part 2 -->
                        <div class="metrics">
                            <div class="metric">
                                <div class="metric-label">Salud API</div>
                                <div class="metric-value" id="metric-health">–</div>
                                <div class="metric-hint">Respuesta de /health</div>
                            </div>
                            <div class="metric">
                                <div class="metric-label">Cuentas ML</div>
                                <div class="metric-value" id="metric-accounts">0</div>
                                <div class="metric-hint">Cuentas conectadas</div>
                            </div>
                            <div class="metric">
                                <div class="metric-label">Modo</div>
                                <div class="metric-value">Demo</div>
                                <div class="metric-hint">Listo para configurar</div>
                            </div>
                        </div>

                        <div class="row mt-4">
                            <div class="col-md-4">
                                <div class="card stat-card p-3">
                                    <div class="stat-icon"><i class="fab fa-whatsapp"></i></div>
                                    <h5>WhatsApp</h5>
                                    <p class="mb-0">Estado: <span class="badge bg-success">Activo</span></p>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="card stat-card p-3">
                                    <div class="stat-icon"><i class="fas fa-store"></i></div>
                                    <h5>Marketplace</h5>
                                    <p class="mb-0">Estado: <span class="badge bg-warning">En espera</span></p>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="card stat-card p-3">
                                    <div class="stat-icon"><i class="fas fa-shopping-bag"></i></div>
                                    <h5>Mercado Libre</h5>
                                    <p class="mb-0">Estado: <span class="badge bg-success">Activo</span></p>
                                </div>
                            </div>
                        </div>

                        <div class="card mt-4 p-3">
                             <h5>Próximos pasos</h5>
                             <div class="list-group list-group-flush">
                                <div class="list-group-item">✔ API levantada en localhost.</div>
                                <div class="list-group-item">✔ Preparado para integrar inventario y publicaciones.</div>
                                <div class="list-group-item">• Preguntas y respuestas automáticas (IA).</div>
                                <div class="list-group-item">• Mensajes post-compra automatizados.</div>
                             </div>
                        </div>
                    </div>

                    <!-- Inbox Section -->
                    <div id="inbox" class="section-content">
                        <div class="chat-container">
                            <div class="chat-list" id="chat-list">
                                <div class="text-center p-3 text-muted">Cargando chats...</div>
                            </div>
                            <div class="chat-main">
                                <div class="chat-header" id="chat-header">
                                    Selecciona una conversación
                                </div>
                                <div class="chat-messages" id="chat-messages">
                                    <!-- Messages will be loaded here -->
                                </div>
                                <div class="chat-input">
                                    <input type="text" class="form-control" id="message-input" placeholder="Escribe un mensaje...">
                                    <button class="btn btn-primary" onclick="sendMessage()"><i class="fas fa-paper-plane"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Kanban Section -->
                    <div id="kanban" class="section-content">
                        <h2>Tablero de Ventas</h2>
                        <div class="kanban-board mt-4">
                            <div class="kanban-column" ondrop="drop(event, 'new')" ondragover="allowDrop(event)">
                                <div class="kanban-header">Nuevos <span class="badge bg-primary rounded-pill" id="count-new">0</span></div>
                                <div id="col-new" class="kanban-items"></div>
                            </div>
                            <div class="kanban-column" ondrop="drop(event, 'contacted')" ondragover="allowDrop(event)">
                                <div class="kanban-header">Contactados (Bot) <span class="badge bg-info rounded-pill" id="count-contacted">0</span></div>
                                <div id="col-contacted" class="kanban-items"></div>
                            </div>
                            <div class="kanban-column" ondrop="drop(event, 'interested')" ondragover="allowDrop(event)">
                                <div class="kanban-header">Interesados / Atención <span class="badge bg-warning rounded-pill" id="count-interested">0</span></div>
                                <div id="col-interested" class="kanban-items"></div>
                            </div>
                            <div class="kanban-column" ondrop="drop(event, 'sale')" ondragover="allowDrop(event)">
                                <div class="kanban-header">Venta Cerrada <span class="badge bg-success rounded-pill" id="count-sale">0</span></div>
                                <div id="col-sale" class="kanban-items"></div>
                            </div>
                            <div class="kanban-column" ondrop="drop(event, 'not_interested')" ondragover="allowDrop(event)">
                                <div class="kanban-header">No Interesado <span class="badge bg-secondary rounded-pill" id="count-not_interested">0</span></div>
                                <div id="col-not_interested" class="kanban-items"></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Inventory Section (Merged from Part 2) -->
                    <div id="inventory" class="section-content">
                        <div class="card p-3">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <h4 class="card-title">Inventario local</h4>
                                    <div class="card-subtitle text-muted">
                                        Productos de tu Excel (inventario_ml.xlsx) listos para automatización.
                                    </div>
                                </div>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                     <input type="file" id="pdf-upload" accept=".pdf" style="display: none;" onchange="uploadPDF(this)">
                                     <button class="btn btn-secondary" type="button" onclick="document.getElementById('pdf-upload').click()">
                                        📄 Importar PDF
                                    </button>
                                    <button id="btn-refresh-excel" class="btn btn-primary" type="button" onclick="loadInventory()">
                                        🔄 Recargar Excel
                                    </button>
                                </div>
                            </div>
                            
                            <div class="alert alert-info" id="inventory-empty" style="display: none;">
                                No hay productos en el Excel.
                            </div>
                            
                            <div style="overflow-x: auto;">
                                <table id="inventory-table" class="table table-hover">
                                    <thead>
                                        <tr>
                                            <th>Producto</th>
                                            <th>Precio</th>
                                            <th>Stock</th>
                                            <th>Lote Inicial</th>
                                            <th>Estado (Bot)</th>
                                        </tr>
                                    </thead>
                                    <tbody id="inventory-body"></tbody>
                                </table>
                            </div>
                            
                            <div id="inventory-catalog" style="margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"></div>
                            
                            <section id="image-search-panel" class="card mt-3 p-3" style="display: none;">
                                <div class="card-title" id="image-search-title">Imágenes sugeridas</div>
                                <div id="image-search-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 8px;"></div>
                            </section>
                            
                            <section id="competition-panel" class="card mt-3 p-3" style="display: none;">
                                <div class="card-title" id="competition-title">Competencia</div>
                                <div id="competition-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 8px;"></div>
                            </section>
                        </div>
                    </div>

                    <!-- Settings Section -->
                    <div id="settings" class="section-content">
                        <h2>Configuración</h2>
                        <div class="card p-3">
                            <h5>Conexión Mercado Libre</h5>
                            <p>Conecta tu cuenta para sincronizar publicaciones y preguntas.</p>
                            <button id="btn-connect-ml" class="btn btn-primary w-auto" style="max-width: 200px;">Conectar Mercado Libre</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Toast Container for Notifications -->
        <div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 1100;"></div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
            let currentLeadId = null;
            let lastNotifiedIds = new Set();
            // Simple notification sound
            const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

            // --- Notifications ---
            async function checkGlobalNotifications() {
                try {
                    // Check for NEW leads or leads requiring attention
                    const res = await fetch('/api/chat/leads');
                    if (!res.ok) return;
                    const leads = await res.json();
                    
                    let newAlerts = 0;
                    
                    leads.forEach(lead => {
                        // Condition 1: Status is 'new' or 'interested'
                        if (lead.status === 'new' || lead.status === 'interested') {
                            // Condition 2: Recent message (e.g. last 2 minutes) to avoid spamming old ones on reload
                            const lastMsgTime = new Date(lead.last_message_at).getTime();
                            const now = new Date().getTime();
                            const timeDiff = now - lastMsgTime;
                            
                            // If message is recent (< 2 mins) OR it's 'interested' and not acknowledged
                            if (timeDiff < 120000 || lead.status === 'interested') {
                                if (!lastNotifiedIds.has(lead.id + '_' + lead.last_message_at)) {
                                    showToast(lead);
                                    lastNotifiedIds.add(lead.id + '_' + lead.last_message_at);
                                    newAlerts++;
                                }
                            }
                        }
                    });
                    
                    if (newAlerts > 0) {
                        try {
                            notificationSound.play().catch(e => console.log("Audio play failed - user interaction needed first"));
                        } catch(e) {}
                    }
                    
                } catch(e) {
                    console.error("Notification check failed", e);
                }
            }

            function showToast(lead) {
                const container = document.getElementById('toastContainer');
                
                let title = "Nuevo Mensaje";
                let bgClass = "text-primary";
                
                if (lead.status === 'interested') {
                    title = "¡ATENCIÓN REQUERIDA!";
                    bgClass = "text-danger";
                }
                
                const toastHtml = `
                    <div class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="10000">
                      <div class="toast-header">
                        <strong class="me-auto ${bgClass}"><i class="fas fa-bell me-2"></i>${title}</strong>
                        <small class="text-muted">Justo ahora</small>
                        <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                      </div>
                      <div class="toast-body">
                        <strong>${lead.platform.toUpperCase()}</strong><br>
                        ${lead.name || lead.remote_id}<br>
                        <span class="badge bg-${lead.status === 'interested' ? 'danger' : 'info'}">${lead.status}</span>
                      </div>
                    </div>
                `;
                
                const temp = document.createElement('div');
                temp.innerHTML = toastHtml;
                const toastEl = temp.firstElementChild;
                container.appendChild(toastEl);
                const toast = new bootstrap.Toast(toastEl);
                toast.show();
                
                // Cleanup after hide
                toastEl.addEventListener('hidden.bs.toast', () => {
                    toastEl.remove();
                });
            }

            // --- Navigation ---
            function showSection(sectionId) {
                document.querySelectorAll('.section-content').forEach(el => el.classList.remove('active'));
                document.getElementById(sectionId).classList.add('active');
                
                document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
                // Highlight current nav link
                const navLinks = document.querySelectorAll('.nav-link');
                navLinks.forEach(link => {
                    if (link.getAttribute('onclick').includes(sectionId)) {
                        link.classList.add('active');
                    }
                });

                if (sectionId === 'inbox') loadChats();
                if (sectionId === 'kanban') loadKanban();
                if (sectionId === 'inventory') loadInventory();
            }

            // --- Kanban Logic ---
            async function loadKanban() {
                try {
                    const response = await fetch('/api/chat/leads');
                    const leads = await response.json();
                    
                    // Clear columns
                    const statuses = ['new', 'contacted', 'interested', 'sale', 'not_interested'];
                    statuses.forEach(status => {
                        const col = document.getElementById(`col-${status}`);
                        if(col) col.innerHTML = '';
                        const count = document.getElementById(`count-${status}`);
                        if(count) count.innerText = '0';
                    });

                    const counts = { new: 0, contacted: 0, interested: 0, sale: 0, not_interested: 0 };

                    // Reset notifications if leads are empty (or maybe just keep track)
                    // checkNotifications(leads); call below

                    leads.forEach(lead => {
                        let status = lead.status || 'new';
                        // Map old statuses if necessary
                        if (status === 'closed') status = 'sale'; // Migrate closed to sale for now

                        if (!counts.hasOwnProperty(status)) return; // Skip invalid status
                        
                        counts[status]++;
                        const card = document.createElement('div');
                        card.className = `kanban-card priority-${getPriorityClass(lead.priority)}`;
                        // Add border if interested
                        if (status === 'interested') {
                            card.style.border = "2px solid #dc3545";
                            card.style.backgroundColor = "#fff5f5";
                        }
                        
                        card.draggable = true;
                        card.ondragstart = (e) => drag(e, lead.id);
                        
                        // Add 'Respond' button/link
                        card.innerHTML = `
                            <div class="d-flex justify-content-between">
                                <strong>${lead.name || lead.remote_id}</strong>
                                <small class="text-muted">${lead.platform}</small>
                            </div>
                            <div class="small text-truncate text-muted mt-1" style="max-width: 200px;">
                                ${lead.last_message_at ? new Date(lead.last_message_at).toLocaleTimeString() : ''}
                            </div>
                            ${status === 'interested' ? '<div class="mt-2 text-danger small"><i class="fas fa-exclamation-circle"></i> Solicita Atención</div>' : ''}
                        `;
                        // Click to open chat
                        card.style.cursor = 'pointer';
                        card.onclick = () => {
                            showSection('inbox');
                            // Wait for DOM update
                            setTimeout(() => {
                                loadMessages(lead.id, lead.name || lead.remote_id);
                            }, 100);
                        };

                        const col = document.getElementById(`col-${status}`);
                        if(col) col.appendChild(card);
                    });
                    
                    // Check for notifications
                    checkNotifications(leads);

                    // Update counts
                    for (const [key, value] of Object.entries(counts)) {
                        const el = document.getElementById(`count-${key}`);
                        if(el) el.innerText = value;
                    }
                } catch (e) {
                    console.error("Error loading Kanban:", e);
                }
            }

            function getPriorityClass(priority) {
                if (priority === 3) return 'high';
                if (priority === 2) return 'medium';
                return 'low';
            }

            // Notification Logic
            let lastNotifiedLeads = new Set();
            
            function checkNotifications(leads) {
                const interestedLeads = leads.filter(l => l.status === 'interested');
                
                interestedLeads.forEach(lead => {
                    if (!lastNotifiedLeads.has(lead.id)) {
                        // New alert!
                        showNotification(`¡Atención! ${lead.name || lead.remote_id} solicita un asesor.`);
                        lastNotifiedLeads.add(lead.id);
                        playNotificationSound();
                    }
                });
            }

            function showNotification(msg) {
                // Check if browser supports notifications
                if (!("Notification" in window)) {
                    alert(msg);
                } else if (Notification.permission === "granted") {
                    new Notification("Bot Asistente Ventas", { body: msg });
                } else if (Notification.permission !== "denied") {
                    Notification.requestPermission().then(function (permission) {
                        if (permission === "granted") {
                            new Notification("Bot Asistente Ventas", { body: msg });
                        }
                    });
                }
                
                // Also show a toast in UI
                const toastContainer = document.getElementById('toast-container');
                if(!toastContainer) {
                    const container = document.createElement('div');
                    container.id = 'toast-container';
                    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999;';
                    document.body.appendChild(container);
                }
                
                const toast = document.createElement('div');
                toast.className = 'toast show';
                toast.role = 'alert';
                toast.innerHTML = `
                    <div class="toast-header bg-danger text-white">
                        <strong class="me-auto">⚠️ Alerta de Atención</strong>
                        <button type="button" class="btn-close btn-close-white" onclick="this.parentElement.parentElement.remove()"></button>
                    </div>
                    <div class="toast-body bg-white text-dark">
                        ${msg}
                    </div>
                `;
                document.getElementById('toast-container').appendChild(toast);
                
                // Auto hide after 10s
                setTimeout(() => toast.remove(), 10000);
            }
            
            function playNotificationSound() {
                // Simple beep using AudioContext or a predefined file if available
                // For now, let's try a simple oscillator beep
                try {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, ctx.currentTime);
                    osc.connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.5);
                } catch(e) {
                    console.log("Audio not supported");
                }
            }

            function allowDrop(ev) {
                ev.preventDefault();
            }

            function drag(ev, leadId) {
                ev.dataTransfer.setData("text", leadId);
            }

            async function drop(ev, status) {
                ev.preventDefault();
                const leadId = ev.dataTransfer.getData("text");
                
                // Call API to update status
                const response = await fetch(`/api/chat/leads/${leadId}/status`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({status: status})
                });

                if (response.ok) {
                    loadKanban();
                } else {
                    alert('Error actualizando estado');
                }
            }

            // --- Chat Logic ---
            function loadChats() {
                fetch('/api/chat/leads')
                    .then(response => response.json())
                    .then(leads => {
                        const list = document.getElementById('chat-list');
                        if(!list) return;
                        list.innerHTML = '';
                        leads.forEach(lead => {
                            const div = document.createElement('div');
                            // Add priority class to chat item for visual distinction
                            let priorityClass = 'priority-low';
                            if (lead.priority === 3) priorityClass = 'priority-high';
                            if (lead.priority === 2) priorityClass = 'priority-medium';

                            div.className = `chat-item ${priorityClass}`;
                            div.onclick = () => loadMessages(lead.id, lead.name || lead.remote_id);
                            
                            // Highlight active
                            if (currentLeadId === lead.id) div.classList.add('active');

                            div.innerHTML = `
                                <div class="d-flex justify-content-between align-items-center">
                                    <strong>${lead.name || lead.remote_id}</strong>
                                    <small class="text-muted" style="font-size:0.7rem">${lead.last_message_at ? new Date(lead.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</small>
                                </div>
                                <div class="small text-muted text-truncate d-flex justify-content-between">
                                    <span>${lead.platform}</span>
                                    <span class="badge bg-secondary" style="font-size:0.6rem">${lead.status}</span>
                                </div>
                            `;
                            list.appendChild(div);
                        });
                    })
                    .catch(e => console.error("Error loading chats:", e));
            }
            
            async function loadMessages(leadId, name) {
                currentLeadId = leadId;
                document.getElementById('chat-header').innerText = name;
                
                const response = await fetch(`/api/chat/leads/${leadId}/messages`);
                const messages = await response.json();
                
                const container = document.getElementById('chat-messages');
                container.innerHTML = '';
                
                messages.forEach(msg => {
                    const div = document.createElement('div');
                    // Check if sender is user or bot
                    const isUser = msg.sender === 'user' || msg.sender === 'client'; 
                    div.className = `message ${isUser ? 'received' : 'sent'}`;
                    div.innerText = msg.content;
                    
                    const time = document.createElement('div');
                    time.className = 'text-muted small text-end';
                    time.innerText = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    div.appendChild(time);

                    container.appendChild(div);
                });
                
                container.scrollTop = container.scrollHeight;
                
                // Refresh list to show active state
                loadChats();
            }

            async function sendMessage() {
                const input = document.getElementById('message-input');
                const content = input.value.trim();
                if (!content || !currentLeadId) return;
                
                // Optimistic UI update
                const container = document.getElementById('chat-messages');
                const div = document.createElement('div');
                div.className = 'message sent';
                div.innerText = content;
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
                input.value = '';

                try {
                    const response = await fetch(`/api/chat/leads/${currentLeadId}/reply`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({content})
                    });
                    
                    if (!response.ok) {
                        alert('Error al enviar mensaje');
                        div.style.backgroundColor = '#ffcccc'; // Indicate error
                    } else {
                        // Reload to get server confirmation/id
                        // loadMessages(currentLeadId, document.getElementById('chat-header').innerText);
                    }
                } catch (e) {
                    console.error(e);
                    div.style.backgroundColor = '#ffcccc';
                }
            }

            // --- Inventory Logic ---
            async function loadInventory() {
                const body = document.getElementById("inventory-body");
                const empty = document.getElementById("inventory-empty");
                if(!body) return;
                
                body.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px;'>Cargando inventario...</td></tr>";
                try {
                    const res = await fetch("/api/inventory/excel");
                    if (!res.ok) throw new Error("Inventory error");
                    const products = await res.json();
                    
                    if (!products || products.length === 0) {
                        empty.style.display = "block";
                        body.innerHTML = "";
                        return;
                    }
                    empty.style.display = "none";
                    renderInventory(products);
                } catch (e) {
                    console.error(e);
                    empty.style.display = "block";
                    empty.textContent = "Error al cargar el Excel o archivo no encontrado.";
                    body.innerHTML = "";
                }
            }

            function renderInventory(products) {
                const body = document.getElementById("inventory-body");
                body.innerHTML = "";
                products.forEach((p) => {
                        const tr = document.createElement("tr");
                        tr.innerHTML = `
                            <td>
                                <div style="font-weight: 500;">${p.Producto || "Sin nombre"}</div>
                            </td>
                            <td>$ ${Number(p.Precio).toLocaleString("es-VE")}</td>
                            <td>${p.Stock_Actual}</td>
                            <td>${p.Lote_Inicial || "-"}</td>
                            <td>
                                <span class="badge bg-secondary">${p.Respuesta || "Consultar"}</span>
                            </td>
                        `;
                        body.appendChild(tr);
                });
            }

            async function uploadPDF(input) {
                if (!input.files || input.files.length === 0) return;
                
                const file = input.files[0];
                const formData = new FormData();
                formData.append("file", file);

                const btn = document.querySelector("button[onclick*='pdf-upload']");
                const originalText = btn.innerHTML;
                btn.innerHTML = "⏳ Procesando...";
                btn.disabled = true;

                try {
                    const res = await fetch("/api/inventory/import-pdf", {
                        method: "POST",
                        body: formData
                    });
                    
                    if (!res.ok) throw new Error("Error uploading PDF");
                    
                    const result = await res.json();
                    
                    alert(result.message || "PDF procesado.");
                    
                    // Recargar el inventario desde el Excel actualizado
                    loadInventory();

                } catch (e) {
                    console.error(e);
                    alert("Error al procesar el PDF.");
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    input.value = ""; // Reset input
                }
            }
            
            function setupConnectML() {
                const btn = document.getElementById("btn-connect-ml");
                if (!btn) return;
                btn.addEventListener("click", async () => {
                    try {
                        const res = await fetch("/api/ml/auth/url");
                        if (!res.ok) {
                            const data = await res.json().catch(() => null);
                            alert(data?.detail || "Configura tus credenciales de Mercado Libre en el backend.");
                            return;
                        }
                        const data = await res.json();
                        if (data.auth_url) {
                            window.open(data.auth_url, "_blank");
                        }
                    } catch (e) {
                        alert("No se pudo obtener la URL de conexión con Mercado Libre.");
                    }
                });
            }

            // --- Status & Metrics ---
            async function updateStatus() {
                const pill = document.getElementById("status-pill");
                const text = document.getElementById("status-text");
                const metricHealth = document.getElementById("metric-health");
                const metricAccounts = document.getElementById("metric-accounts");
                const accountLabel = document.getElementById("ml-account-name");
                
                try {
                    // Simple health check first
                    const healthRes = await fetch("/health");
                    if (!healthRes.ok) throw new Error("Health error");
                    const healthData = await healthRes.json();
                    
                    if(pill) {
                        pill.classList.remove("error");
                        pill.classList.add("ok");
                    }
                    if(text) text.textContent = "Online";
                    if(metricHealth) metricHealth.textContent = healthData.status || "ok";

                    // Check accounts
                    try {
                        const accountsRes = await fetch("/api/ml/accounts/");
                        if (accountsRes.ok) {
                            const accounts = await accountsRes.json();
                            let accountsCount = 0;
                            let firstAccountName = null;
                            if (Array.isArray(accounts)) {
                                accountsCount = accounts.length;
                                if (accounts.length > 0) {
                                    firstAccountName = accounts[0].nickname || accounts[0].name || accounts[0].id || null;
                                }
                            }
                            if(metricAccounts) metricAccounts.textContent = accountsCount.toString();
                            if(accountLabel) {
                                if (firstAccountName) {
                                    accountLabel.textContent = `Cuenta: ${firstAccountName}`;
                                } else {
                                    accountLabel.textContent = "Cuenta: no conectada";
                                }
                            }
                        }
                    } catch(err) {
                        console.log("ML Accounts check failed (expected if not configured)");
                    }

                } catch (e) {
                    if(pill) {
                        pill.classList.remove("ok");
                        pill.classList.add("error");
                    }
                    if(text) text.textContent = "Offline";
                    if(metricHealth) metricHealth.textContent = "error";
                }
            }

            // --- Auto-refresh ---
            setInterval(() => {
                // Check notifications ALWAYS (Global)
                checkGlobalNotifications();

                const inbox = document.getElementById('inbox');
                const kanban = document.getElementById('kanban');
                
                if (inbox && inbox.classList.contains('active')) {
                     loadChats();
                }
                
                if (kanban && kanban.classList.contains('active')) {
                    loadKanban();
                }
                
                // Update status every 30s
                // updateStatus(); 
            }, 10000); // Reduce to 10 seconds for faster alerts

            // --- Initialization ---
            document.addEventListener('DOMContentLoaded', () => {
                updateStatus();
                setupConnectML();
                
                // Initial loads
                loadChats();
                loadKanban();
            });

        </script>
    </body>
    </html>
    """
