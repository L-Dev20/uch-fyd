# UCH-FyD frontend

Responsive general marketplace for the UCH-FyD SOA project. It uses plain HTML, CSS and JavaScript, so no frontend build step or package installation is required.

## Run

The page reads the catalog from the API Gateway. Serve it with the included Docker Compose stack or a local static server; it includes search/category filters, favorites, a persistent cart, sign-in/register, checkout and administration tabs for products, orders and account activation.

## Connect the API Gateway

Edit `config.js` only if the Gateway origin changes:

- Set `apiBaseUrl` to the gateway origin, such as `https://gateway.example.test`.
- Keep `demoMode` disabled; the storefront does not use local placeholder products.
- Update route paths to match the published service contracts.

The current default paths match the starter backend. In particular, Identity and Administration are one service under the `/identidad` route prefix. All calls go through the gateway; the browser never connects directly to MongoDB.

The adapter expects JSON responses. Catalog responses may be an array or an object containing `items`, `productos`, or `data`. Product properties accept either Spanish or English names (`id`/`_id`/`productoId`, `name`/`nombre`, `category`/`categoria`, `price`/`precio`, `stock`/`disponibilidad`). Login/register should return `{ token, user }` or `{ accessToken, user }`, with a `role` on the user. Order creation sends `{ items: [{ productoId, cantidad }], cliente }`, a Bearer token, and a unique `Idempotency-Key` header.

The backend uses HTTP 409 for insufficient stock. The frontend does not automatically retry a purchase. If the network fails after submission, it preserves the cart and the same idempotency key so the customer can retry without duplicating the order.

## Main files

- `index.html`: page structure, catalog, cart, authentication and administration panels.
- `styles.css`: responsive visual system and components.
- `app.js`: state, API adapter, catalog rendering, cart, authentication and administration behavior.
- `config.js`: gateway URL and route mapping.
