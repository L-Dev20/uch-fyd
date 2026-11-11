# UCH-FyD backend

Backend SOA para un marketplace. Respeta la restricción del TP: MongoDB Atlas para usuarios y PostgreSQL para productos, stock y pedidos.

```text
Web app → API Gateway → Identidad y Administración (MongoDB Atlas)
                      → Catálogo (PostgreSQL)
                      → Pedidos y Stock (PostgreSQL)
```

Identidad y Administración forman un solo servicio conectado a MongoDB Atlas. Catálogo y Pedidos/Stock usan PostgreSQL; la confirmación bloquea filas con `SELECT FOR UPDATE` y actualiza stock y pedido dentro de una transacción ACID. pgAdmin administra PostgreSQL. El navegador se comunica únicamente con el Gateway.

## Iniciar con Docker

Requisitos: Docker Desktop con Docker Compose. No se requieren MySQL ni Workbench.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Antes de levantar el stack, edita `.env`: coloca la URI de Atlas en `MONGODB_URL` y la clave PostgreSQL que usarás en `POSTGRES_PASSWORD`.

Abrí `http://localhost:5173/?live=1`. El Gateway queda en `4100`, Identidad en `4101`, Catálogo en `4102` y Pedidos en `4103`.

pgAdmin queda disponible en `http://localhost:8080` con `admin@correo.com` / `TuPasswordSeguro123`. Para registrar PostgreSQL dentro de pgAdmin:

```text
Host: postgres
Puerto: 5432
Base: uchfyd
Usuario: uchfyd
Contraseña: TuPasswordSeguro123
```

## Ejecutar Node fuera de Docker

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run dev
```

Para probar PostgreSQL de forma independiente, sin iniciar los cuatro servicios:

```powershell
npm run db:check
```

El diagnóstico usa el mismo `.env` y la misma conexión que Catálogo y Pedidos, pero nunca imprime la contraseña.

El `.env` debe contener la URI de MongoDB Atlas en `MONGODB_URL` y los valores `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`. Catálogo y Pedidos usan esos mismos campos.

## Bases remotas

Configura `MONGODB_URL` con MongoDB Atlas y `POSTGRES_URL` para Catálogo/Pedidos remotos. El Compose remoto no levanta bases; Atlas y PostgreSQL deben aceptar conexiones desde el despliegue.

```env
MONGODB_URL=mongodb+srv://usuario:contraseña@cluster.example.mongodb.net/?retryWrites=true&w=majority
POSTGRES_URL=postgresql://usuario:contraseña@servidor:5432/uchfyd
```

## Persistencia y consistencia

- MongoDB Atlas: usuarios, roles, activación, credenciales y JWT.
- PostgreSQL `uchfyd`: productos, stock, pedidos, detalle e idempotencia.
- Pedidos usa `SELECT FOR UPDATE`, transacción ACID y rollback ante errores.
- pgAdmin permite inspeccionar y administrar el PostgreSQL del entorno Docker.

En producción deben configurarse autenticación, TLS, usuarios con privilegios mínimos, respaldos, monitoreo y migraciones para ambas bases.

## Rutas

Todas las rutas públicas usan `/api/v1`: catálogo (`GET /catalogo/productos`), identidad (`POST /identidad/registro`, `POST /identidad/login`), administración y pedidos (`POST /pedidos`, `GET /pedidos`).

## Componentes

- `services/gateway/server.js`: entrada pública y enrutamiento.
- `services/identity-admin/server.js`: usuarios, roles, activación, login y JWT en MongoDB Atlas.
- `services/catalog/server.js`: catálogo y productos en PostgreSQL.
- `services/orders/server.js`: compras, stock, transacciones e idempotencia en PostgreSQL.
- `lib/postgres.js`: pool y transacciones PostgreSQL.
- `docker-compose.yml`: PostgreSQL, pgAdmin, servicios y frontend; Identity usa MongoDB Atlas externo.

## Error de autenticación PostgreSQL (`28P01`)

El volumen de PostgreSQL conserva la contraseña del rol aunque cambie `POSTGRES_PASSWORD` en `.env`; Compose no la sincroniza automáticamente. Para actualizar el rol `uchfyd` sin borrar la base, recrea el contenedor con la configuración actual y ejecuta `ALTER ROLE` dentro del servicio `postgres`. Después valida con `npm run db:check`. No uses `docker compose down -v` para este caso: eso elimina el volumen de datos.
