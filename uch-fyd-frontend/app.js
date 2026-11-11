/*
 * UCH-FyD storefront. All API access lives in GatewayClient below.
 * Set window.UCHFYD_CONFIG before this file to connect the real gateway.
 */
const DEFAULT_CONFIG = {
  apiBaseUrl: "http://localhost:4100",
  demoMode: false,
  routes: {
    products: "/api/v1/catalogo/productos",
    login: "/api/v1/identidad/login",
    register: "/api/v1/identidad/registro",
    me: "/api/v1/identidad/usuario",
    orders: "/api/v1/pedidos",
    adminProducts: "/api/v1/identidad/administracion/productos",
    adminOrders: "/api/v1/identidad/administracion/pedidos",
    adminUsers: "/api/v1/identidad/administracion/usuarios"
  }
};
const CONFIG = { ...DEFAULT_CONFIG, ...(window.UCHFYD_CONFIG || {}), routes: { ...DEFAULT_CONFIG.routes, ...(window.UCHFYD_CONFIG?.routes || {}) } };
const state = {
  products: [], cart: JSON.parse(localStorage.getItem("uchfyd-cart") || "[]"), category: "Todos", query: "", inStock: false,
  sort: "Destacados", authMode: "login", user: JSON.parse(localStorage.getItem("uchfyd-user") || "null"),
  token: localStorage.getItem("uchfyd-token"), orderKey: localStorage.getItem("uchfyd-order-key"),
  demoAccounts: JSON.parse(localStorage.getItem("uchfyd-demo-accounts") || "[]"),
  wishlist: new Set(JSON.parse(localStorage.getItem("uchfyd-wishlist") || "[]")), adminTab: "products", showAdminForm: false, editingProduct: null
};

class GatewayClient {
  constructor(config) { this.config = config; }
  async request(path, options = {}) {
    if (this.config.demoMode) return this.demoRequest(path, options);
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    try {
      const response = await fetch(`${this.config.apiBaseUrl}${path}`, { ...options, headers });
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(body?.message || body?.error || `HTTP ${response.status}`);
        error.status = response.status; error.body = body; throw error;
      }
      return body;
    } catch (error) {
      if (error instanceof TypeError) { error.networkError = true; }
      throw error;
    }
  }
  async demoRequest(path, options = {}) {
    await new Promise(resolve => setTimeout(resolve, 160));
    const data = options.body ? JSON.parse(options.body) : {};
    if (path === this.config.routes.products) return { items: state.products };
    if ([this.config.routes.login, this.config.routes.register].includes(path)) {
      if (path === this.config.routes.register) { const user = { id: `demo-user-${Date.now()}`, name: data.name, email: data.email, role: "client", active: false }; state.demoAccounts.push(user); localStorage.setItem("uchfyd-demo-accounts", JSON.stringify(state.demoAccounts)); return { status: "pending_activation", message: "La cuenta quedó pendiente de activación por administración." }; }
      const admin = data.email?.toLowerCase() === "admin@uchfyd.com";
      const account = state.demoAccounts.find(user => user.email.toLowerCase() === data.email?.toLowerCase());
      if (account && !account.active) throw Object.assign(new Error("Tu cuenta todavía está pendiente de activación."), { status: 403 });
      const user = account || { id: "demo-user", name: admin ? "Equipo UCH-FyD" : data.email?.split("@")[0], email: data.email, role: admin ? "admin" : "client", active: true };
      return { token: `demo.${btoa(unescape(encodeURIComponent(JSON.stringify({ email: user.email, role: user.role }))))}.signature`, user };
    }
    if (path === this.config.routes.orders) {
      return { id: `PED-${String(Math.floor(1000 + Math.random() * 9000))}`, status: "created", items: data.items || [] };
    }
    if (path === this.config.routes.adminProducts && options.method === "POST") {
      const item = { id: `p${Date.now()}`, ...data, price: Number(data.price), stock: Number(data.stock), type: data.type || "box", badge: "" };
      state.products = [...state.products, item]; return item;
    }
    if (path.startsWith(this.config.routes.adminProducts + "/") && options.method === "PATCH") {
      const id = path.split("/").pop(); const product = state.products.find(p => String(p.id) === id);
      if (product) Object.assign(product, data); return product;
    }
    if (path === this.config.routes.adminOrders) return { items: [] };
    throw Object.assign(new Error("Ruta no configurada"), { status: 404 });
  }
  products() { return this.request(this.config.routes.products); }
  login(data, register = false) { return this.request(register ? this.config.routes.register : this.config.routes.login, { method: "POST", body: JSON.stringify(data) }); }
  createOrder(data, key) { return this.request(this.config.routes.orders, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(data) }); }
  addProduct(data) { return this.request(this.config.routes.adminProducts, { method: "POST", body: JSON.stringify(data) }); }
  updateProduct(id, data) { return this.request(`${this.config.routes.adminProducts}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }); }
  orders() { return this.request(this.config.routes.adminOrders); }
  users() { if (this.config.demoMode) return Promise.resolve({ items: state.demoAccounts }); return this.request(this.config.routes.adminUsers); }
  updateUser(id, action, value) { if (this.config.demoMode) { const user = state.demoAccounts.find(item => item.id === id); if (user) user[action] = value; localStorage.setItem("uchfyd-demo-accounts", JSON.stringify(state.demoAccounts)); return Promise.resolve({ user }); } return this.request(`${this.config.routes.adminUsers}/${encodeURIComponent(id)}/${action === "active" ? "activar" : "rol"}`, { method: "PATCH", body: JSON.stringify(action === "active" ? { active: value } : { role: value }) }); }
}
const api = new GatewayClient(CONFIG);
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function persist() { localStorage.setItem("uchfyd-cart", JSON.stringify(state.cart)); state.orderKey = null; localStorage.removeItem("uchfyd-order-key"); }
function visual(product, cart = false) { return `<div class="${cart ? "cart-thumb" : "product-image"}"><span class="${cart ? "product-art-small" : "product-art"}">${safe(product.emoji || "📦")}</span></div>`; }
function productList() {
  let list = state.products.filter(p => state.category === "Todos" || p.category === state.category);
  if (state.query.trim()) list = list.filter(p => `${p.name} ${p.category} ${p.description || ""}`.toLowerCase().includes(state.query.toLowerCase()));
  if (state.inStock) list = list.filter(p => p.stock > 0);
  if (state.sort === "Precio menor") list.sort((a, b) => a.price - b.price);
  if (state.sort === "Precio mayor") list.sort((a, b) => b.price - a.price);
  return list;
}
function renderCategories() {
  const categories = ["Todos", ...new Set(state.products.map(p => p.category))];
  $("#category-list").innerHTML = categories.map(category => `<button class="category-button ${state.category === category ? "active" : ""}" data-category="${safe(category)}">${safe(category)} <span>${category === "Todos" ? String(state.products.length).padStart(2, "0") : String(state.products.filter(p => p.category === category).length).padStart(2, "0")}</span></button>`).join("");
}
function renderProducts() {
  const list = productList();
  $("#result-count").textContent = `${String(list.length).padStart(2, "0")} productos`;
  $("#product-grid").innerHTML = list.map((p, i) => `<article class="product-card" data-product="${safe(p.id)}"><div class="product-image tone-${i % 6 + 1} ${safe(p.type || "generic")}">${p.badge ? `<span class="product-badge">${safe(p.badge)}</span>` : ""}<button class="wishlist ${state.wishlist.has(p.id) ? "saved" : ""}" data-wish="${safe(p.id)}" aria-label="${state.wishlist.has(p.id) ? "Quitar de" : "Agregar a"} favoritos">${state.wishlist.has(p.id) ? "♥" : "♡"}</button><span class="product-art">${safe(p.emoji || "📦")}</span></div><div class="product-info"><div><h3>${safe(p.name)}</h3><span class="product-category">${safe(p.category)} · ${p.stock > 0 ? "Disponible" : "Sin stock"}</span></div><div class="product-price">${money(p.price)}<small>por unidad</small></div></div><button class="add-button" data-add="${safe(p.id)}" ${p.stock < 1 ? "disabled" : ""}><span>${p.stock > 0 ? "Agregar al pedido" : "Sin disponibilidad"}</span><span>${p.stock > 0 ? "+" : "—"}</span></button></article>`).join("");
  $("#empty-state").hidden = list.length > 0;
  $("#product-grid").hidden = list.length === 0;
  const chips = [];
  if (state.category !== "Todos") chips.push(`<button class="filter-chip" data-clear="category">${safe(state.category)} ×</button>`);
  if (state.query) chips.push(`<button class="filter-chip" data-clear="query">${safe(state.query)} ×</button>`);
  if (state.inStock) chips.push(`<button class="filter-chip" data-clear="stock">En stock ×</button>`);
  $("#active-filters").innerHTML = chips.join("");
  renderCategories();
}
function getCartLines() { return state.cart.map(line => ({ ...line, product: state.products.find(p => String(p.id) === String(line.id)) })).filter(line => line.product); }
function renderCart() {
  const lines = getCartLines(); const count = lines.reduce((sum, line) => sum + line.quantity, 0); const total = lines.reduce((sum, line) => sum + line.quantity * line.product.price, 0);
  $("#cart-count").textContent = count; $("#drawer-count").textContent = `(${count})`; $("#cart-total").textContent = money(total);
  $("#cart-empty").hidden = count > 0; $("#cart-footer").hidden = count === 0;
  $("#cart-items").innerHTML = lines.map(line => `<div class="cart-item">${visual(line.product, true)}<div><h4>${safe(line.product.name)}</h4><small>${money(line.product.price)} · ${safe(line.product.category)}</small><div class="quantity"><button data-qty="${safe(line.id)}" data-delta="-1" aria-label="Quitar uno">−</button><span>${line.quantity}</span><button data-qty="${safe(line.id)}" data-delta="1" aria-label="Agregar uno">+</button><button class="remove-item" data-remove="${safe(line.id)}">Quitar</button></div></div><div class="cart-item-price">${money(line.product.price * line.quantity)}</div></div>`).join("");
}
let toastTimer;
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }
function openLayer(target) { $("#overlay").hidden = false; requestAnimationFrame(() => $("#overlay").classList.add("visible")); if (target === "cart") { $("#cart-drawer").classList.add("open"); $("#cart-drawer").setAttribute("aria-hidden", "false"); } else { $(target).classList.add("open"); $(target).setAttribute("aria-hidden", "false"); } document.body.classList.add("layer-open"); }
function closeLayers() { $("#overlay").classList.remove("visible"); setTimeout(() => { $("#overlay").hidden = true; }, 180); ["#cart-drawer", "#auth-modal", "#admin-modal"].forEach(id => { $(id).classList.remove("open"); $(id).setAttribute("aria-hidden", "true"); }); document.body.classList.remove("layer-open"); }
function openAuth(mode = "login") { state.authMode = mode; renderAuthMode(); openLayer("#auth-modal"); }
function renderAuthMode() { const register = state.authMode === "register"; $("#auth-title").textContent = register ? "Creá tu cuenta." : "Ingresá a tu cuenta."; $("#auth-subtitle").textContent = register ? "Completá tus datos para solicitar una cuenta." : "Usá solamente tu correo y contraseña."; $("#name-field").hidden = !register; $("#name-field input").required = register; $("#auth-form input[name=email]").autocomplete = register ? "email" : "username"; $("#auth-form input[name=password]").autocomplete = register ? "new-password" : "current-password"; $("#auth-submit").textContent = register ? "Crear cuenta" : "Ingresar"; document.querySelectorAll(".auth-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.authMode === state.authMode)); $("#auth-message").textContent = ""; $("#auth-message").className = "form-message"; }
function messageFor(error, context = "") {
  if (error.status === 400 || error.status === 409) return context === "order" ? "No hay stock suficiente para completar el pedido. Revisá las cantidades." : (error.message || "Revisá los datos e intentá nuevamente.");
  if (error.status === 401 || error.status === 403) return "Tu sesión expiró o no tenés permiso para esta acción. Ingresá nuevamente.";
  if (error.status === 503 || error.status === 502 || error.status === 504) return "El servicio está con mucha demanda. Tu carrito sigue guardado; probá de nuevo en unos segundos.";
  if (error.networkError) return context === "order" ? "No pudimos confirmar si el pedido se procesó. No vuelvas a enviarlo: consultá tus pedidos o reintentá con la misma clave." : "No pudimos conectar con el servicio. Intentá nuevamente.";
  return error.message || "Ocurrió un problema. Intentá nuevamente.";
}
function persistUser(result) { state.token = result.token || result.accessToken || null; state.user = result.user || result.usuario || null; if (state.token) localStorage.setItem("uchfyd-token", state.token); else localStorage.removeItem("uchfyd-token"); if (state.user) localStorage.setItem("uchfyd-user", JSON.stringify(state.user)); else localStorage.removeItem("uchfyd-user"); }
function isAdmin() { return ["admin", "administrador", "ADMIN"].includes(state.user?.role || state.user?.rol); }
function openAdmin() { if (!state.user) return openAuth("login"); if (!isAdmin()) return toast("Tu cuenta no tiene permisos de administración."); renderAdmin(); openLayer("#admin-modal"); }
async function renderAdmin() {
  document.querySelectorAll(".admin-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.adminTab === state.adminTab));
  const content = $("#admin-content");
  if (state.adminTab === "orders") {
    content.innerHTML = `<div class="admin-toolbar"><span>Pedidos recientes</span></div><p class="admin-empty">${CONFIG.demoMode ? "La vista queda conectada al contrato de administración." : "Cargando pedidos…"}</p>`;
    if (!CONFIG.demoMode) { try { const result = await api.orders(); const rows = result.items || result.pedidos || []; content.innerHTML = `<div class="admin-toolbar"><span>${rows.length} pedidos</span></div>${rows.length ? `<table class="admin-table"><thead><tr><th>Nº</th><th>CLIENTE</th><th>ESTADO</th><th>TOTAL</th></tr></thead><tbody>${rows.map(o => `<tr><td>${safe(o.id || o.numero)}</td><td>${safe(o.cliente || o.usuario?.nombre)}</td><td>${safe(o.estado || "Recibido")}</td><td>${money(o.total || 0)}</td></tr>`).join("")}</tbody></table>` : "<p class='admin-empty'>Todavía no hay pedidos.</p>"}`; } catch (e) { content.innerHTML = `<p class="admin-empty">${safe(messageFor(e))}</p>`; } }
    return;
  }
  if (state.adminTab === "users") {
    content.innerHTML = `<p class="admin-empty">Cargando cuentas…</p>`;
    try {
      const result = await api.users(); const rows = result.items || result.usuarios || [];
      content.innerHTML = `${rows.length ? `<table class="admin-table"><thead><tr><th>CUENTA</th><th>ESTADO</th><th>ROL</th><th>ACCIONES</th></tr></thead><tbody>${rows.map(user => `<tr><td><span class="admin-product"><span class="admin-swatch">♙</span><span>${safe(user.name || user.nombre)}<small class="account-email">${safe(user.email || user.correo)}</small></span></span></td><td><span class="stock-status ${user.active ? "" : "out"}">${user.active ? "Activa" : "Pendiente"}</span></td><td>${safe(user.role || user.rol)}</td><td><button class="admin-action" data-user-action="active" data-user-id="${safe(user.id || user._id)}" data-value="${!user.active}">${user.active ? "Desactivar" : "Activar"}</button> <button class="admin-action" data-user-action="role" data-user-id="${safe(user.id || user._id)}" data-value="${(user.role || user.rol) === "admin" ? "client" : "admin"}">${(user.role || user.rol) === "admin" ? "Hacer cliente" : "Hacer admin"}</button></td></tr>`).join("")}</tbody></table>` : `<p class="admin-empty">No hay cuentas registradas todavía.</p>`}`;
    } catch (error) { content.innerHTML = `<p class="admin-empty">${safe(messageFor(error))}</p>`; }
    return;
  }
  const editing = state.editingProduct;
  const formProduct = editing || { name: "", category: "", description: "", price: "", stock: 0, type: "box", emoji: "📦", badge: "", active: true };
  content.innerHTML = `<div class="admin-toolbar"><span>${state.products.length} productos en el catálogo</span><button id="new-product-button">+ Nuevo producto</button></div>${state.showAdminForm ? `<form id="admin-product-form" class="admin-form"><div class="admin-form-grid"><label class="form-field">Nombre<input name="name" value="${safe(formProduct.name)}" required /></label><label class="form-field">Categoría<input name="category" value="${safe(formProduct.category)}" required /></label><label class="form-field">Descripción<textarea name="description" rows="2">${safe(formProduct.description)}</textarea></label><label class="form-field">Precio (ARS)<input name="price" type="number" min="0" step="0.01" value="${safe(formProduct.price)}" required /></label><label class="form-field">Stock<input name="stock" type="number" min="0" value="${safe(formProduct.stock)}" required /></label><label class="form-field">Tipo visual<input name="type" value="${safe(formProduct.type)}" /></label><label class="form-field">Emoji<input name="emoji" value="${safe(formProduct.emoji)}" /></label><label class="form-field">Etiqueta<input name="badge" value="${safe(formProduct.badge)}" /></label><label class="check-row admin-active"><input name="active" type="checkbox" ${formProduct.active !== false ? "checked" : ""} /> Producto visible</label></div><div class="admin-form-actions"><button class="primary-button" type="submit">${editing ? "Guardar cambios" : "Crear producto"} <span>→</span></button>${editing ? `<button class="text-button" type="button" id="cancel-product-edit">Cancelar</button>` : ""}</div></form>` : ""}<table class="admin-table"><thead><tr><th>PRODUCTO</th><th>PRECIO</th><th>STOCK</th><th>ESTADO</th><th></th></tr></thead><tbody>${state.products.map(p => `<tr><td><span class="admin-product"><span class="admin-swatch">${safe(p.emoji || "✳")}</span><span>${safe(p.name)}<small class="account-email">${safe(p.category)}</small></span></span></td><td>${money(p.price)}</td><td>${p.stock} u.</td><td><span class="stock-status ${p.active === false || !p.stock ? "out" : ""}">${p.active === false ? "Oculto" : p.stock ? "Disponible" : "Sin stock"}</span></td><td><button class="admin-action" data-edit-product="${safe(p.id)}">Editar</button></td></tr>`).join("")}</tbody></table>`;
}
function updateProduct(id, values) { const product = state.products.find(p => String(p.id) === String(id)); if (!product) return; api.updateProduct(id, values).then(updated => { Object.assign(product, updated, { active: values.active }); renderProducts(); state.showAdminForm = false; state.editingProduct = null; renderAdmin(); toast("Producto actualizado."); }).catch(error => toast(messageFor(error))); }
function bindEvents() {
  $("#search").addEventListener("input", e => { state.query = e.target.value; renderProducts(); });
  $("#search").addEventListener("focus", e => { if (innerWidth <= 640) e.target.closest(".searchbox").classList.add("expanded"); });
  $("#account-button").addEventListener("click", () => state.user ? (isAdmin() ? openAdmin() : toast(`Hola, ${state.user.name || state.user.nombre || "qué bueno verte"}.`)) : openAuth());
  $("#cart-button").addEventListener("click", () => { renderCart(); openLayer("cart"); });
  $("#overlay").addEventListener("click", closeLayers);
  document.addEventListener("click", e => {
    const close = e.target.closest("[data-close]"); if (close) closeLayers();
    const category = e.target.closest("[data-category]"); if (category) { state.category = category.dataset.category; renderProducts(); }
    const add = e.target.closest("[data-add]"); if (add) { const p = state.products.find(item => String(item.id) === add.dataset.add); if (p) { const line = state.cart.find(item => String(item.id) === String(p.id)); if (line) line.quantity = Math.min(p.stock, line.quantity + 1); else state.cart.push({ id: p.id, quantity: 1 }); persist(); renderCart(); toast(`${p.name} se agregó a tu pedido.`); } }
    const qty = e.target.closest("[data-qty]"); if (qty) { const line = state.cart.find(item => String(item.id) === qty.dataset.qty); const p = state.products.find(item => String(item.id) === qty.dataset.qty); if (line) { line.quantity += Number(qty.dataset.delta); if (line.quantity <= 0) state.cart = state.cart.filter(item => item !== line); else if (p) line.quantity = Math.min(p.stock, line.quantity); persist(); renderCart(); } }
    const remove = e.target.closest("[data-remove]"); if (remove) { state.cart = state.cart.filter(item => String(item.id) !== remove.dataset.remove); persist(); renderCart(); }
    const wish = e.target.closest("[data-wish]"); if (wish) { state.wishlist.has(wish.dataset.wish) ? state.wishlist.delete(wish.dataset.wish) : state.wishlist.add(wish.dataset.wish); localStorage.setItem("uchfyd-wishlist", JSON.stringify([...state.wishlist])); renderProducts(); }
    const chip = e.target.closest("[data-clear]"); if (chip) { if (chip.dataset.clear === "category") state.category = "Todos"; if (chip.dataset.clear === "query") { state.query = ""; $("#search").value = ""; } if (chip.dataset.clear === "stock") { state.inStock = false; $("#in-stock").checked = false; } renderProducts(); }
    const authTab = e.target.closest("[data-auth-mode]"); if (authTab) { state.authMode = authTab.dataset.authMode; renderAuthMode(); }
    const adminTab = e.target.closest("[data-admin-tab]"); if (adminTab) { state.adminTab = adminTab.dataset.adminTab; renderAdmin(); }
    if (e.target.closest("#new-product-button")) { state.editingProduct = null; state.showAdminForm = !state.showAdminForm; renderAdmin(); }
    const edit = e.target.closest("[data-edit-product]"); if (edit) { state.editingProduct = state.products.find(item => String(item.id) === edit.dataset.editProduct) || null; state.showAdminForm = true; renderAdmin(); }
    if (e.target.closest("#cancel-product-edit")) { state.editingProduct = null; state.showAdminForm = false; renderAdmin(); }
    const accountAction = e.target.closest("[data-user-action]"); if (accountAction) { const action = accountAction.dataset.userAction; const value = action === "active" ? accountAction.dataset.value === "true" : accountAction.dataset.value; accountAction.disabled = true; api.updateUser(accountAction.dataset.userId, action, value).then(() => { toast(action === "active" ? "Estado de cuenta actualizado." : "Rol de cuenta actualizado."); renderAdmin(); }).catch(error => { toast(messageFor(error)); accountAction.disabled = false; }); }
  });
  $("#in-stock").addEventListener("change", e => { state.inStock = e.target.checked; renderProducts(); });
  $("#sort-button").addEventListener("click", () => { state.sort = state.sort === "Destacados" ? "Precio menor" : state.sort === "Precio menor" ? "Precio mayor" : "Destacados"; $("#sort-button").innerHTML = `${state.sort} <span>⌄</span>`; renderProducts(); });
  $("#clear-filters").addEventListener("click", () => { state.category = "Todos"; state.query = ""; state.inStock = false; $("#search").value = ""; $("#in-stock").checked = false; renderProducts(); });
  $("#auth-form").addEventListener("submit", async e => { e.preventDefault(); const authForm = e.currentTarget; const form = new FormData(authForm); const data = Object.fromEntries(form.entries()); const button = authForm.querySelector("button[type=submit]"); button.disabled = true; $("#auth-message").textContent = "Conectando…"; try { const registering = state.authMode === "register"; const result = await api.login(data, registering); if (registering && result.status === "pending_activation") { $("#auth-message").className = "form-message success"; $("#auth-message").textContent = result.message || "Tu cuenta quedó pendiente de activación."; const passwordInput = authForm.elements.namedItem("password"); if (passwordInput) passwordInput.value = ""; return; } persistUser(result); closeLayers(); toast(isAdmin() ? "Sesión de administración iniciada." : "Ya estás dentro. ¡Qué bueno tenerte!"); if (isAdmin()) { renderAdmin(); openLayer("#admin-modal"); } } catch (error) { $("#auth-message").className = "form-message"; $("#auth-message").textContent = messageFor(error); } finally { button.disabled = false; } });
  $("#checkout-button").addEventListener("click", async e => { if (!state.user || !state.token) { closeLayers(); return openAuth("login"); } const lines = getCartLines(); if (!lines.length) return; const button = e.currentTarget; button.disabled = true; button.textContent = "Confirmando pedido…"; if (!state.orderKey) { state.orderKey = crypto.randomUUID ? crypto.randomUUID() : `uch-${Date.now()}-${Math.random().toString(16).slice(2)}`; localStorage.setItem("uchfyd-order-key", state.orderKey); } const payload = { items: lines.map(line => ({ productoId: line.id, cantidad: line.quantity })), cliente: state.user.id || state.user.email }; try { const result = await api.createOrder(payload, state.orderKey); state.cart = []; persist(); closeLayers(); renderCart(); toast(`Pedido ${result.id || result.numero || "confirmado"}. ¡Gracias por elegirnos!`); } catch (error) { toast(messageFor(error, "order")); } finally { button.disabled = false; button.innerHTML = 'Continuar con mi pedido <span>→</span>'; } });
  $("#admin-content").addEventListener("submit", async e => { if (e.target.id !== "admin-product-form") return; e.preventDefault(); const data = Object.fromEntries(new FormData(e.target).entries()); data.active = e.target.elements.active.checked; data.price = Number(data.price); data.stock = Number(data.stock); const button = e.target.querySelector("button[type=submit]"); button.disabled = true; try { if (state.editingProduct) updateProduct(state.editingProduct.id, data); else { const item = await api.addProduct(data); state.products.push(item); state.showAdminForm = false; renderProducts(); renderAdmin(); toast("Producto agregado al catálogo."); } } catch (error) { toast(messageFor(error)); button.disabled = false; } });
  $("#logout-button").addEventListener("click", () => { persistUser({}); closeLayers(); toast("Sesión cerrada."); });
  document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); } if (e.key === "Escape") closeLayers(); });
}
async function init() {
  try { const result = await api.products(); const data = Array.isArray(result) ? result : (result?.items || result?.productos || result?.data || []); state.products = data.map(p => ({ ...p, id: p.id ?? p._id ?? p.productoId ?? p.codigo, name: p.name ?? p.nombre, category: p.category ?? p.categoria ?? "Otros", price: Number(p.price ?? p.precio ?? 0), stock: Number(p.stock ?? p.disponibilidad ?? 0), type: p.type || "generic", emoji: p.emoji || "📦" })); } catch (error) { state.products = []; toast("No se pudo cargar el catálogo desde el servidor."); }
  renderProducts(); renderCart(); bindEvents();
}
init();
