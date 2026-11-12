/*
 * UCH-FyD storefront. All API access lives in GatewayClient below.
 * Set window.UCHFYD_CONFIG before this file to connect the real gateway.
 */
const DEFAULT_CONFIG = {
  apiBaseUrl: "http://localhost:4100",
  demoMode: false,
  routes: {
    products: "/api/v1/catalogo/productos",
    categories: "/api/v1/catalogo/categorias",
    login: "/api/v1/identidad/login",
    register: "/api/v1/identidad/registro",
    me: "/api/v1/identidad/usuario",
    orders: "/api/v1/pedidos",
    adminProducts: "/api/v1/identidad/administracion/productos",
    adminCategories: "/api/v1/identidad/administracion/categorias",
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
  demoCategories: JSON.parse(localStorage.getItem("uchfyd-demo-categories") || "[]"),
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
    if (path === this.config.routes.categories) return { items: [...new Set([...state.demoCategories, ...state.products.map(product => product.category)])].map(name => ({ name })) };
    if ([this.config.routes.login, this.config.routes.register].includes(path)) {
      if (path === this.config.routes.register) { const user = { id: `demo-user-${Date.now()}`, name: data.name, email: data.email, role: "client", active: false }; state.demoAccounts.push(user); localStorage.setItem("uchfyd-demo-accounts", JSON.stringify(state.demoAccounts)); return { status: "pending_activation", message: "La cuenta quedó pendiente de activación por administración." }; }
      const admin = data.email?.toLowerCase() === "admin@uchfyd.com";
      const account = state.demoAccounts.find(user => user.email.toLowerCase() === data.email?.toLowerCase());
      if (account && !account.active) throw Object.assign(new Error("Tu cuenta todavía está pendiente de activación."), { status: 403 });
      const user = account || { id: "demo-user", name: admin ? "Equipo UCH-FyD" : data.email?.split("@")[0], email: data.email, role: admin ? "admin" : "client", active: true };
      return { token: `demo.${btoa(unescape(encodeURIComponent(JSON.stringify({ email: user.email, role: user.role }))))}.signature`, user };
    }
    if (path === this.config.routes.orders && options.method === "GET") return { items: [] };
    if (path === this.config.routes.orders) {
      return { id: `PED-${String(Math.floor(1000 + Math.random() * 9000))}`, status: "created", items: data.items || [] };
    }
    if (path === this.config.routes.adminProducts && options.method === "POST") {
      const item = { id: `p${Date.now()}`, ...data, price: Number(data.price), stock: Number(data.stock) };
      state.products = [...state.products, item]; return item;
    }
    if (path === this.config.routes.adminCategories && options.method === "POST") {
      if (!state.demoCategories.includes(data.name)) state.demoCategories.push(data.name);
      localStorage.setItem("uchfyd-demo-categories", JSON.stringify(state.demoCategories));
      return { name: data.name };
    }
    if (path.startsWith(this.config.routes.adminProducts + "/") && options.method === "PATCH") {
      const id = path.split("/").pop(); const product = state.products.find(p => String(p.id) === id);
      if (product) Object.assign(product, data); return product;
    }
    if (path === this.config.routes.adminOrders) return { items: [] };
    throw Object.assign(new Error("Ruta no configurada"), { status: 404 });
  }
  products() { return this.request(this.config.routes.products); }
  categories() { return this.request(this.config.routes.categories); }
  login(data, register = false) { return this.request(register ? this.config.routes.register : this.config.routes.login, { method: "POST", body: JSON.stringify(data) }); }
  createOrder(data, key) {
    if (isAdmin()) return Promise.reject(Object.assign(new Error("La cuenta administradora no puede realizar compras."), { status: 403 }));
    return this.request(this.config.routes.orders, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(data) });
  }
  me() { return this.request(this.config.routes.me); }
  myOrders() {
    if (isAdmin()) return Promise.reject(Object.assign(new Error("La cuenta administradora no tiene compras personales."), { status: 403 }));
    return this.request(this.config.routes.orders);
  }
  addProduct(data) { return this.request(this.config.routes.adminProducts, { method: "POST", body: JSON.stringify(data) }); }
  addCategory(name) { return this.request(this.config.routes.adminCategories, { method: "POST", body: JSON.stringify({ name }) }); }
  updateProduct(id, data) { return this.request(`${this.config.routes.adminProducts}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }); }
  orders() { return this.request(this.config.routes.adminOrders); }
  users() { if (this.config.demoMode) return Promise.resolve({ items: state.demoAccounts }); return this.request(this.config.routes.adminUsers); }
  updateUser(id, action, value) { if (this.config.demoMode) { const user = state.demoAccounts.find(item => item.id === id); if (user) user[action] = value; localStorage.setItem("uchfyd-demo-accounts", JSON.stringify(state.demoAccounts)); return Promise.resolve({ user }); } return this.request(`${this.config.routes.adminUsers}/${encodeURIComponent(id)}/${action === "active" ? "activar" : "rol"}`, { method: "PATCH", body: JSON.stringify(action === "active" ? { active: value } : { role: value }) }); }
}
const api = new GatewayClient(CONFIG);
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const productImages = [
  { terms: ["auricular", "audio", "headphone", "tecnolog", "electr", "comput"], url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80" },
  { terms: ["zapat", "deport", "sneaker", "calzado"], url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80" },
  { terms: ["lámpara", "lampara", "hogar", "mueble"], url: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80" },
  { terms: ["ropa", "moda", "vestimenta"], url: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=80" },
  { terms: ["cámara", "camara", "foto"], url: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80" },
  { terms: ["reloj", "watch"], url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80" },
  { terms: ["mochila", "backpack"], url: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80" }
];
const fallbackProductImage = "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=800&q=80";
function productImageUrl(product) {
  const imageUrl = String(product.imageUrl || product.image_url || product.imagenUrl || "").trim();
  if (imageUrl) {
    try {
      const url = new URL(imageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {}
  }
  const description = `${product.name || ""} ${product.category || ""}`.toLowerCase();
  return productImages.find(({ terms }) => terms.some(term => description.includes(term)))?.url || fallbackProductImage;
}
function productImage(product, className) {
  return `<img class="${className}" src="${productImageUrl(product)}" alt="${safe(product.name || product.category || "Producto")}" loading="lazy" />`;
}
function persist() { localStorage.setItem("uchfyd-cart", JSON.stringify(state.cart)); }
function clearOrderKey() { state.orderKey = null; localStorage.removeItem("uchfyd-order-key"); }
function clearCustomerState() { state.cart = []; persist(); clearOrderKey(); }
function visual(product, cart = false) { return `<div class="${cart ? "cart-thumb" : "product-image"}">${productImage(product, cart ? "product-art-small" : "product-art")}</div>`; }
function productList() {
  let list = state.products.filter(p => p.active !== false && (state.category === "Todos" || p.category === state.category));
  if (state.query.trim()) list = list.filter(p => `${p.name} ${p.category} ${p.description || ""}`.toLowerCase().includes(state.query.toLowerCase()));
  if (state.inStock) list = list.filter(p => p.stock > 0);
  if (state.sort === "Precio menor") list.sort((a, b) => a.price - b.price);
  if (state.sort === "Precio mayor") list.sort((a, b) => b.price - a.price);
  return list;
}
function renderCategories() {
  const visibleProducts = state.products.filter(p => p.active !== false);
  const categories = ["Todos", ...new Set(visibleProducts.map(p => p.category))];
  $("#category-list").innerHTML = categories.map(category => `<button class="category-button ${state.category === category ? "active" : ""}" data-category="${safe(category)}">${safe(category)} <span>${category === "Todos" ? String(visibleProducts.length).padStart(2, "0") : String(visibleProducts.filter(p => p.category === category).length).padStart(2, "0")}</span></button>`).join("");
}
function renderProducts() {
  if (state.category !== "Todos" && !state.products.some(p => p.active !== false && p.category === state.category)) state.category = "Todos";
  const list = productList();
  $("#result-count").textContent = `${String(list.length).padStart(2, "0")} productos`;
  $("#product-grid").innerHTML = list.map((p, i) => `
    <article class="product-card" data-product="${safe(p.id)}">
      <div class="product-image tone-${i % 6 + 1}">
        <button class="wishlist ${state.wishlist.has(p.id) ? "saved" : ""}" data-wish="${safe(p.id)}" aria-label="${state.wishlist.has(p.id) ? "Quitar de" : "Agregar a"} favoritos">${state.wishlist.has(p.id) ? "♥" : "♡"}</button>
        ${productImage(p, "product-art")}
      </div>
      <div class="product-info">
        <div>
          <h3>${safe(p.name)}</h3>
          <span class="product-category">${safe(p.category)} · ${p.stock > 0 ? `${p.stock} ${p.stock === 1 ? "disponible" : "disponibles"}` : "Sin stock"}</span>
        </div>
        <div class="product-price">${money(p.price)}<small>por unidad</small></div>
      </div>
      <button class="add-button" data-add="${safe(p.id)}" ${p.stock < 1 ? "disabled" : ""}>
        <span>${p.stock > 0 ? "Agregar al pedido" : "Sin disponibilidad"}</span>
        <span>${p.stock > 0 ? "+" : "—"}</span>
      </button>
    </article>
  `).join("");
  if (isAdmin()) document.querySelectorAll("#product-grid [data-add]").forEach(button => button.remove());
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
let overlayHideTimer;
const layerSelectors = ["#cart-drawer", "#auth-modal", "#admin-modal", "#account-modal", "#orders-modal", "#checkout-modal"];
function openLayer(target) {
  clearTimeout(overlayHideTimer);
  const selector = target === "cart" ? "#cart-drawer" : target;
  for (const id of layerSelectors) {
    const active = id === selector;
    $(id).classList.toggle("open", active);
    $(id).setAttribute("aria-hidden", String(!active));
  }
  if (selector !== "#checkout-modal") document.querySelectorAll("#checkout-form [data-payment-field]").forEach(input => { input.value = ""; });
  $("#overlay").hidden = false;
  requestAnimationFrame(() => $("#overlay").classList.add("visible"));
  document.body.classList.add("layer-open");
}
function closeLayers() {
  clearTimeout(overlayHideTimer);
  $("#overlay").classList.remove("visible");
  overlayHideTimer = setTimeout(() => { $("#overlay").hidden = true; }, 180);
  layerSelectors.forEach(id => { $(id).classList.remove("open"); $(id).setAttribute("aria-hidden", "true"); });
  document.querySelectorAll("#checkout-form [data-payment-field]").forEach(input => { input.value = ""; });
  document.body.classList.remove("layer-open");
}
function openAuth(mode = "login") { state.authMode = mode; renderAuthMode(); openLayer("#auth-modal"); }
function renderAuthMode() {
  const register = state.authMode === "register";
  $("#auth-title").textContent = register ? "Creá tu cuenta." : "Ingresá a tu cuenta.";
  $("#auth-subtitle").textContent = register ? "Completá tus datos para solicitar una cuenta." : "Usá solamente tu correo y contraseña.";
  $("#name-field").hidden = !register;
  $("#name-field input").required = register;
  $("#auth-form input[name=email]").autocomplete = register ? "email" : "username";
  $("#auth-form input[name=password]").autocomplete = register ? "new-password" : "current-password";
  $("#auth-form").reset();
  $("#auth-submit").textContent = register ? "Crear cuenta" : "Ingresar";
  document.querySelectorAll(".auth-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.authMode === state.authMode));
  $("#auth-message").textContent = "";
  $("#auth-message").className = "form-message";
}
function messageFor(error, context = "") {
  if (context === "auth") return error.message || "No se pudo iniciar sesión. Revisá tus credenciales.";
  if ((error.status === 400 || error.status === 409) && context === "order") return error.message || "Revisá los datos de la compra y el stock disponible.";
  if (error.status === 400 || error.status === 409) return error.message || "Revisá los datos e intentá nuevamente.";
  if (error.status === 401 || error.status === 403) return error.message || "Tu sesión expiró o no tenés permiso para esta acción. Ingresá nuevamente.";
  if (error.status === 503 || error.status === 502 || error.status === 504) return "El servicio está con mucha demanda. Tu carrito sigue guardado; probá de nuevo en unos segundos.";
  if (error.networkError) return context === "order" ? "No pudimos confirmar si el pedido se procesó. No vuelvas a enviarlo: consultá tus pedidos o reintentá con la misma clave." : "No pudimos conectar con el servicio. Intentá nuevamente.";
  return error.message || "Ocurrió un problema. Intentá nuevamente.";
}
function persistUser(result) {
  const previousId = state.user?.id || state.user?._id;
  state.token = result.token || result.accessToken || null;
  state.user = result.user || result.usuario || null;
  const nextId = state.user?.id || state.user?._id;
  if (previousId !== nextId || isAdmin()) clearCustomerState();
  if (state.token) localStorage.setItem("uchfyd-token", state.token); else localStorage.removeItem("uchfyd-token");
  if (state.user) localStorage.setItem("uchfyd-user", JSON.stringify(state.user)); else localStorage.removeItem("uchfyd-user");
  renderAccountButton();
  renderProducts();
  renderCart();
}
function isAdmin() { return ["admin", "administrador", "ADMIN"].includes(state.user?.role || state.user?.rol); }
function renderAccountButton() {
  const button = $("#account-button");
  if (!button) return;
  const admin = isAdmin();
  const purchasesLink = document.querySelector(".header-links > a.header-action");
  if (purchasesLink) purchasesLink.hidden = admin;
  $("#cart-button").hidden = admin;
  const name = state.user?.name || state.user?.nombre || state.user?.email || "Mi cuenta";
  button.innerHTML = `<span class="action-icon"><img class="ui-icon" src="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/icons/person-circle.svg" alt="" /></span><span>${state.user ? "Hola," : "Ingresá"}<br /><b>${safe(state.user ? name : "o creá tu cuenta")}</b></span><i>⌄</i>`;
  $("#mobile-menu").setAttribute("aria-label", state.user ? `Abrir cuenta de ${name}` : "Abrir menú");
}
function clearSession() {
  persistUser({});
  clearCustomerState();
  closeLayers();
}
function renderProfile() {
  $("#profile-name").textContent = state.user?.name || state.user?.nombre || "Mi cuenta";
  $("#profile-email").textContent = state.user?.email || state.user?.correo || "";
  $("#profile-role").textContent = isAdmin() ? "Administrador" : "Usuario";
  $("#profile-orders-button").hidden = isAdmin();
  $("#profile-admin-button").hidden = !isAdmin();
}
function refreshProducts() {
  return api.products().then(result => {
    const data = Array.isArray(result) ? result : (result?.items || result?.productos || result?.data || []);
    state.products = data.map(p => ({ ...p, id: p.id ?? p._id ?? p.productoId ?? p.codigo, name: p.name ?? p.nombre, category: p.category ?? p.categoria ?? "Otros", imageUrl: p.imageUrl ?? p.image_url ?? p.imagenUrl ?? "", price: Number(p.price ?? p.precio ?? 0), stock: Number(p.stock ?? p.disponibilidad ?? 0) }));
    renderProducts();
  });
}
function openAdmin() { if (!state.user || !state.token) return openAuth("login"); if (!isAdmin()) return toast("Tu cuenta no tiene permisos de administración."); renderAdmin(); openLayer("#admin-modal"); if (state.showAdminForm) loadCategoryOptions(state.editingProduct?.category || "").catch(error => toast(messageFor(error))); }
async function openMyOrders() {
  if (!state.user || !state.token) return openAuth("login");
  if (isAdmin()) return toast("La cuenta administradora no puede tener compras personales.");
  const requestedUserId = state.user.id || state.user._id;
  const requestedToken = state.token;
  $("#orders-content").innerHTML = `<p class="admin-empty">Cargando tus compras…</p>`;
  openLayer("#orders-modal");
  try {
    const result = await api.myOrders();
    if (state.token !== requestedToken || (state.user?.id || state.user?._id) !== requestedUserId) return;
    const orders = result.items || result.pedidos || [];
    $("#orders-content").innerHTML = orders.length ? `<div class="order-list">${orders.map(order => `<article class="order-card"><div class="order-card-head"><b>Pedido ${safe(order.id || order.numero)}</b><span>${safe(order.estado || order.status || "Confirmado")}</span></div><small>${order.createdAt ? safe(new Date(order.createdAt).toLocaleString("es-AR")) : ""}</small><ul>${(order.items || []).map(item => `<li>${safe(item.nombre || item.name)} × ${safe(item.cantidad || item.quantity)}</li>`).join("")}</ul><strong>Total: ${money(order.total || 0)}</strong></article>`).join("")}</div>` : `<p class="admin-empty">Todavía no tenés compras.</p>`;
  } catch (error) {
    $("#orders-content").innerHTML = `<p class="admin-empty">${safe(messageFor(error))}</p>`;
    if (error.status === 401) { clearSession(); toast("Tu sesión expiró. Iniciá sesión nuevamente."); }
  }
}
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
      content.innerHTML = `${rows.length ? `<table class="admin-table"><thead><tr><th>CUENTA</th><th>ESTADO</th><th>ROL</th><th>ACCIONES</th></tr></thead><tbody>${rows.map(user => `<tr><td><span class="admin-product"><span class="admin-swatch"><img class="admin-product-image" src="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/icons/person-circle.svg" alt="" /></span><span>${safe(user.name || user.nombre)}<small class="account-email">${safe(user.email || user.correo)}</small></span></span></td><td><span class="stock-status ${user.active ? "" : "out"}">${user.active ? "Activa" : "Pendiente"}</span></td><td>${safe(user.role || user.rol)}</td><td><button class="admin-action" data-user-action="active" data-user-id="${safe(user.id || user._id)}" data-value="${!user.active}">${user.active ? "Desactivar" : "Activar"}</button> <button class="admin-action" data-user-action="role" data-user-id="${safe(user.id || user._id)}" data-value="${(user.role || user.rol) === "admin" ? "client" : "admin"}">${(user.role || user.rol) === "admin" ? "Hacer cliente" : "Hacer admin"}</button></td></tr>`).join("")}</tbody></table>` : `<p class="admin-empty">No hay cuentas registradas todavía.</p>`}`;
    } catch (error) { content.innerHTML = `<p class="admin-empty">${safe(messageFor(error))}</p>`; }
    return;
  }
  const editing = state.editingProduct;
  const formProduct = editing || { name: "", category: "", description: "", price: "", stock: 0, active: true };
  content.innerHTML = `<div class="admin-toolbar"><span>${state.products.length} productos en el catálogo</span><button id="new-product-button">+ Nuevo producto</button></div>${state.showAdminForm ? `<form id="admin-product-form" class="admin-form"><div class="admin-form-grid"><label class="form-field">Nombre<input name="name" value="${safe(formProduct.name)}" required /></label><label class="form-field">Categoría<input name="category" value="${safe(formProduct.category)}" required /></label><label class="form-field">Descripción<textarea name="description" rows="2">${safe(formProduct.description)}</textarea></label><label class="form-field">Precio (ARS)<input name="price" type="number" min="0" step="0.01" value="${safe(formProduct.price)}" required /></label><label class="form-field">Stock<input name="stock" type="number" min="0" value="${safe(formProduct.stock)}" required /></label><label class="check-row admin-active"><input name="active" type="checkbox" ${formProduct.active !== false ? "checked" : ""} /> Producto visible</label></div><div class="admin-form-actions"><button class="primary-button" type="submit">${editing ? "Guardar cambios" : "Crear producto"} <span>→</span></button>${editing ? `<button class="text-button" type="button" id="cancel-product-edit">Cancelar</button>` : ""}</div></form>` : ""}<table class="admin-table"><thead><tr><th>PRODUCTO</th><th>PRECIO</th><th>STOCK</th><th>ESTADO</th><th></th></tr></thead><tbody>${state.products.map(p => `<tr><td><span class="admin-product"><span class="admin-swatch">${productImage(p, "admin-product-image")}</span><span>${safe(p.name)}<small class="account-email">${safe(p.category)}</small></span></span></td><td>${money(p.price)}</td><td>${p.stock} u.</td><td><span class="stock-status ${p.active === false || !p.stock ? "out" : ""}">${p.active === false ? "Oculto" : p.stock ? "Disponible" : "Sin stock"}</span></td><td><button class="admin-action" data-edit-product="${safe(p.id)}">Editar</button></td></tr>`).join("")}</tbody></table>`;
}
async function loadCategoryOptions(selected = "") {
  let select = $("#product-category-select");
  if (!select) {
    const field = $("#admin-product-form input[name=category]");
    if (!field) return;
    const wrapper = document.createElement("div");
    wrapper.className = "category-editor";
    wrapper.innerHTML = `<label class="form-field">Categoría<select id="product-category-select" name="category" required></select></label><button id="create-category-button" class="text-button" type="button">+ Crear categoría</button><div id="category-create-row" class="category-create-row" hidden><label class="form-field">Nombre de la nueva categoría<input id="new-category-name" maxlength="120" /></label><button id="save-category-button" class="admin-action" type="button">Guardar</button></div>`;
    field.closest(".form-field").replaceWith(wrapper);
    select = $("#product-category-select");
    const imageField = document.createElement("label");
    imageField.className = "form-field";
    imageField.append("Imagen del producto (URL)");
    const imageInput = document.createElement("input");
    imageInput.name = "imageUrl";
    imageInput.type = "url";
    imageInput.maxLength = 2048;
    imageInput.placeholder = "https://...";
    imageInput.value = state.editingProduct?.imageUrl || "";
    imageField.append(imageInput);
    wrapper.insertAdjacentElement("beforebegin", imageField);
  }
  select.disabled = true;
  const result = await api.categories();
  const categories = (result.items || result.categorias || []).map(category => category.name || category.nombre).filter(Boolean);
  select.innerHTML = categories.map(name => `<option value="${safe(name)}">${safe(name)}</option>`).join("");
  select.disabled = categories.length === 0;
  select.value = selected;
}
function updateProduct(id, values) { const product = state.products.find(p => String(p.id) === String(id)); if (!product) return; api.updateProduct(id, values).then(updated => { Object.assign(product, updated, { active: values.active }); renderProducts(); state.showAdminForm = false; state.editingProduct = null; renderAdmin(); toast("Producto actualizado."); }).catch(error => toast(messageFor(error))); }
function bindEvents() {
  $("#search").addEventListener("input", e => { state.query = e.target.value; renderProducts(); });
  $("#search").addEventListener("focus", e => { if (innerWidth <= 640) e.target.closest(".searchbox").classList.add("expanded"); });
  $("#account-button").addEventListener("click", () => {
    if (!state.user || !state.token) return openAuth("login");
    renderProfile();
    openLayer("#account-modal");
  });
  $("#mobile-menu").addEventListener("click", () => {
    if (!state.user || !state.token) return openAuth("login");
    renderProfile();
    openLayer("#account-modal");
  });
  document.querySelectorAll(".header-links > a.header-action, .utility-inner nav a").forEach(link => {
    if (link.matches(".header-links > a.header-action") || link.textContent.trim().toLowerCase() === "mis compras") {
      link.addEventListener("click", event => { event.preventDefault(); openMyOrders(); });
    }
  });
  $("#profile-orders-button").addEventListener("click", openMyOrders);
  $("#profile-admin-button").addEventListener("click", () => { closeLayers(); openAdmin(); });
  $("#cart-button").addEventListener("click", () => { if (isAdmin()) return; renderCart(); openLayer("cart"); });
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
    const adminTab = e.target.closest("[data-admin-tab]"); if (adminTab) { state.adminTab = adminTab.dataset.adminTab; renderAdmin(); if (state.adminTab === "products" && state.showAdminForm) loadCategoryOptions(state.editingProduct?.category || "").catch(error => toast(messageFor(error))); }
    if (e.target.closest("#new-product-button")) { state.editingProduct = null; state.showAdminForm = !state.showAdminForm; renderAdmin(); if (state.showAdminForm) loadCategoryOptions().catch(error => toast(messageFor(error))); }
    const edit = e.target.closest("[data-edit-product]"); if (edit) { state.editingProduct = state.products.find(item => String(item.id) === edit.dataset.editProduct) || null; state.showAdminForm = true; renderAdmin(); loadCategoryOptions(state.editingProduct?.category || "").catch(error => toast(messageFor(error))); }
    if (e.target.closest("#cancel-product-edit")) { state.editingProduct = null; state.showAdminForm = false; renderAdmin(); }
    const accountAction = e.target.closest("[data-user-action]"); if (accountAction) { const action = accountAction.dataset.userAction; const value = action === "active" ? accountAction.dataset.value === "true" : accountAction.dataset.value; accountAction.disabled = true; api.updateUser(accountAction.dataset.userId, action, value).then(() => { toast(action === "active" ? "Estado de cuenta actualizado." : "Rol de cuenta actualizado."); renderAdmin(); }).catch(error => { toast(messageFor(error)); accountAction.disabled = false; }); }
  });
  $("#admin-content").addEventListener("click", async event => {
    if (event.target.closest("#create-category-button")) {
      $("#category-create-row").hidden = false;
      $("#new-category-name").focus();
      return;
    }
    if (!event.target.closest("#save-category-button")) return;
    const input = $("#new-category-name");
    const name = input.value.trim();
    if (name.length < 2 || name.length > 120) { toast("Ingresá un nombre de categoría de 2 a 120 caracteres."); return; }
    const button = $("#save-category-button");
    button.disabled = true;
    try {
      const created = await api.addCategory(name);
      await loadCategoryOptions(created.name || name);
      $("#category-create-row").hidden = true;
      input.value = "";
      toast("Categoría creada.");
    } catch (error) {
      toast(messageFor(error));
    } finally {
      button.disabled = false;
    }
  });
  $("#in-stock").addEventListener("change", e => { state.inStock = e.target.checked; renderProducts(); });
  $("#sort-button").addEventListener("click", () => { state.sort = state.sort === "Destacados" ? "Precio menor" : state.sort === "Precio menor" ? "Precio mayor" : "Destacados"; $("#sort-button").innerHTML = `${state.sort} <span>⌄</span>`; renderProducts(); });
  $("#clear-filters").addEventListener("click", () => { state.category = "Todos"; state.query = ""; state.inStock = false; $("#search").value = ""; $("#in-stock").checked = false; renderProducts(); });
  $("#auth-form").addEventListener("submit", async e => { e.preventDefault(); const authForm = e.currentTarget; const form = new FormData(authForm); const data = Object.fromEntries(form.entries()); const button = authForm.querySelector("button[type=submit]"); button.disabled = true; $("#auth-message").textContent = "Conectando…"; try { const registering = state.authMode === "register"; const result = await api.login(data, registering); if (registering && result.status === "pending_activation") { $("#auth-message").className = "form-message success"; $("#auth-message").textContent = result.message || "Tu cuenta quedó pendiente de activación."; const passwordInput = authForm.elements.namedItem("password"); if (passwordInput) passwordInput.value = ""; return; } persistUser(result); closeLayers(); toast(isAdmin() ? "Sesión de administración iniciada." : "Ya estás dentro. ¡Qué bueno tenerte!"); if (isAdmin()) { renderAdmin(); openLayer("#admin-modal"); } } catch (error) { $("#auth-message").className = "form-message"; $("#auth-message").textContent = messageFor(error); } finally { button.disabled = false; } });
  $("#checkout-button").addEventListener("click", () => {
    if (isAdmin()) return toast("La cuenta administradora no puede realizar compras.");
    if (!state.user || !state.token) { closeLayers(); return openAuth("login"); }
    const lines = getCartLines();
    if (!lines.length) return;
    $("#checkout-form").reset();
    $("#checkout-form").elements.namedItem("name").value = state.user.name || state.user.nombre || "";
    $("#checkout-total").textContent = `Total a pagar: ${money(lines.reduce((sum, line) => sum + line.quantity * line.product.price, 0))}`;
    $("#checkout-message").textContent = "";
    closeLayers();
    openLayer("#checkout-modal");
  });
  $("#checkout-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (isAdmin()) { closeLayers(); return toast("La cuenta administradora no puede realizar compras."); }
    if (!state.user || !state.token) { closeLayers(); return openAuth("login"); }
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("#checkout-submit");
    const lines = getCartLines();
    if (!lines.length) return;
    button.disabled = true;
    button.innerHTML = "Confirmando compra…";
    $("#checkout-message").textContent = "Procesando pedido de prueba…";
    if (!state.orderKey) {
      state.orderKey = `uchfyd-v2-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      localStorage.setItem("uchfyd-order-key", state.orderKey);
    }
    const field = name => form.elements.namedItem(name).value.trim();
    const payload = {
      items: lines.map(line => ({ productoId: line.id, cantidad: line.quantity })),
      shippingAddress: { name: field("name"), address: field("address"), city: field("city"), postalCode: field("postalCode"), phone: field("phone") }
    };
    try {
      const result = await api.createOrder(payload, state.orderKey);
      state.cart = [];
      persist();
      clearOrderKey();
      form.reset();
      closeLayers();
      renderCart();
      toast(`Pago simulado aprobado. Pedido ${result.id || result.numero || "confirmado"}.`);
      try { await refreshProducts(); } catch { toast("Pedido confirmado; no se pudo actualizar el catálogo en pantalla."); }
    } catch (error) {
      $("#checkout-message").textContent = messageFor(error, "order");
      if (error.status === 401) { clearSession(); toast("Tu sesión expiró. Iniciá sesión nuevamente."); }
    } finally {
      button.disabled = false;
      button.innerHTML = 'Confirmar compra simulada <span>→</span>';
    }
  });
  $("#admin-content").addEventListener("submit", async e => { if (e.target.id !== "admin-product-form") return; e.preventDefault(); const data = Object.fromEntries(new FormData(e.target).entries()); data.active = e.target.elements.active.checked; data.price = Number(data.price); data.stock = Number(data.stock); const button = e.target.querySelector("button[type=submit]"); button.disabled = true; try { if (state.editingProduct) updateProduct(state.editingProduct.id, data); else { const item = await api.addProduct(data); state.products.push(item); state.showAdminForm = false; renderProducts(); renderAdmin(); toast("Producto agregado al catálogo."); } } catch (error) { toast(messageFor(error)); button.disabled = false; } });
  const logout = () => { clearSession(); toast("Sesión cerrada."); };
  $("#logout-button").addEventListener("click", logout);
  $("#profile-logout-button").addEventListener("click", logout);
  document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); } if (e.key === "Escape") closeLayers(); });
}
async function init() {
  if (isAdmin()) clearCustomerState();
  renderAccountButton();
  if (state.orderKey && !state.orderKey.startsWith("uchfyd-v2-")) clearOrderKey();
  if (!state.token && state.user) persistUser({});
  if (state.token) {
    try { const result = await api.me(); persistUser({ token: state.token, user: result.user || result.usuario || state.user }); }
    catch (error) { if (error.status === 401) clearSession(); }
  }
  try { await refreshProducts(); } catch (error) { state.products = []; toast("No se pudo cargar el catálogo desde el servidor."); }
  renderProducts(); renderCart(); bindEvents();
}
init();
