// The storefront always uses the real Gateway and catalog.
const liveMode = true;
const useDemoData = false;
// Docker/Nginx proxies /api to the Gateway. A separate local static server
// (for example Live Server on port 5500) needs the explicit Gateway origin.
const sameOriginGateway = window.location.port === "5173";
const gatewayOrigin = !sameOriginGateway ? "http://localhost:4100" : "";
window.UCHFYD_CONFIG = {
  apiBaseUrl: gatewayOrigin,
  demoMode: useDemoData,
  routes: {
    products: "/api/v1/catalogo/productos",
    categories: "/api/v1/catalogo/categorias",
    login: "/api/v1/identidad/login",
    register: "/api/v1/identidad/registro",
    me: "/api/v1/identidad/usuario",
    orders: "/api/v1/pedidos",
    // Identity and Administration are exposed by the same service.
    adminProducts: "/api/v1/identidad/administracion/productos",
    adminCategories: "/api/v1/identidad/administracion/categorias",
    adminOrders: "/api/v1/identidad/administracion/pedidos",
    adminUsers: "/api/v1/identidad/administracion/usuarios"
  }
};
