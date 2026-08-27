-- ============================================================
--  KOKORO SHOP LITE — Setup de base de datos (Supabase)
--  Pega TODO este archivo en:  Supabase -> SQL Editor -> Run
--  Es seguro ejecutarlo varias veces (usa IF NOT EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1) USUARIOS (clientes de tu tienda)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,               -- Telegram ID del cliente
  username      TEXT,                             -- @username de Telegram (sin @)
  language      TEXT DEFAULT 'ar',                -- 'ar' o 'en'
  balance       NUMERIC(12,2) DEFAULT 0,          -- saldo del cliente en tu tienda
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Por si la tabla users ya existia con el default anterior ('es'):
ALTER TABLE users ALTER COLUMN language SET DEFAULT 'ar';

-- ------------------------------------------------------------
-- 2a) PROVEEDORES DE API (mayoristas tipo KOKORO)
--     Podes tener mas de uno activo a la vez; el bot sincroniza
--     productos de TODOS los proveedores activos.
--     El primero se crea solo con los valores de KOKORO_API_URL /
--     KOKORO_API_KEY del .env la primera vez que corre la sincronizacion.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_providers (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,                    -- nombre interno (solo lo ves vos en el panel)
  provider_type TEXT DEFAULT 'kokoro',            -- 'kokoro' o 'xpro'
  base_url      TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  active        BOOLEAN DEFAULT true,
  is_default    BOOLEAN DEFAULT false,             -- true = el proveedor creado desde el .env
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- Evita crear el proveedor default dos veces si dos procesos arrancan a la vez:
CREATE UNIQUE INDEX IF NOT EXISTS api_providers_one_default ON api_providers ((is_default)) WHERE is_default = true;
ALTER TABLE api_providers ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'kokoro';

-- ------------------------------------------------------------
-- 2) PRODUCTOS (se sincronizan desde los proveedores activos cada 5 min)
--    El revendedor SOLO configura: markup, enabled y (opcional) emoji.
--    El resto de columnas las actualiza el bot automaticamente.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,                 -- ID unico local (= id del proveedor default, o "p<provider_id>_<id>" para los demas)
  provider_id   BIGINT REFERENCES api_providers(id) ON DELETE CASCADE,
  native_id     TEXT,                              -- ID real del producto EN el proveedor (para comprar)
  name          TEXT NOT NULL,                    -- nombre (lo trae la API)
  price         NUMERIC(12,2) DEFAULT 0,          -- precio MAYORISTA (lo trae la API)
  stock         INT DEFAULT 0,                    -- stock (lo trae la API)
  min_order     INT DEFAULT 1,                    -- cantidad minima (lo trae la API)
  markup        NUMERIC(6,2) DEFAULT 30,          -- ganancia del revendedor: % o monto fijo segun markup_type (LO CONFIGURA EL REVENDEDOR)
  markup_type   TEXT DEFAULT 'percent',           -- 'percent' (%) o 'fixed' (monto fijo en USDT)
  enabled       BOOLEAN DEFAULT true,             -- true = visible en la tienda (TOGGLE del revendedor)
  sort_order    INT DEFAULT 0,                    -- orden manual en la tienda (mayor = aparece primero)
  emoji         TEXT,                             -- (opcional) forzar un emoji; si esta vacio se detecta por nombre
  custom_name   TEXT,                             -- (opcional) nombre propio del revendedor; si esta vacio se usa el de la API
  description_es TEXT,                            -- descripcion en espanol (la trae la API KOKORO)
  description_en TEXT,                            -- descripcion en ingles (la trae la API KOKORO)
  bulk_discounts JSONB DEFAULT '[]'::jsonb,       -- descuentos por volumen (los trae la API KOKORO)
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Por si la tabla products ya existia sin las columnas multi-proveedor:
ALTER TABLE products ADD COLUMN IF NOT EXISTS provider_id BIGINT REFERENCES api_providers(id) ON DELETE CASCADE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS native_id TEXT;
-- Por si la tabla products ya existia sin la columna de nombre propio:
ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_name TEXT;
-- Por si la tabla products ya existia sin el tipo de markup (% o monto fijo):
ALTER TABLE products ADD COLUMN IF NOT EXISTS markup_type TEXT DEFAULT 'percent';
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
-- Por si la tabla products ya existia sin las columnas de descripcion:
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_es TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_en TEXT;
-- Descuentos por volumen (bulk) que trae la API KOKORO:
ALTER TABLE products ADD COLUMN IF NOT EXISTS bulk_discounts JSONB DEFAULT '[]'::jsonb;

-- ------------------------------------------------------------
-- 3) PRODUCTOS MANUALES (productos propios del revendedor)
--    El revendedor los agrega aqui y sube su stock en stock_manual.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products_manual (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  price         NUMERIC(12,2) DEFAULT 0,          -- PRECIO FINAL al cliente (ya con su ganancia)
  min_order     INT DEFAULT 1,
  enabled       BOOLEAN DEFAULT true,             -- TOGGLE para apagar/prender
  sort_order    INT DEFAULT 0,                    -- orden manual en la tienda (mayor = aparece primero)
  emoji         TEXT,                             -- (opcional) emoji del producto
  description_ar TEXT,                            -- descripcion en ARABE (se muestra a clientes en ar)
  description_es TEXT,                            -- descripcion en ESPANOL (legado, ya no se usa en el bot)
  description_en TEXT,                            -- descripcion en INGLES (se muestra a clientes en en)
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Por si la tabla products_manual ya existia sin las columnas de idioma:
ALTER TABLE products_manual ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE products_manual ADD COLUMN IF NOT EXISTS description_es TEXT;
ALTER TABLE products_manual ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE products_manual ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
-- Quitar la columna legada 'description' si existe (ya no se usa):
ALTER TABLE products_manual DROP COLUMN IF EXISTS description;

-- ------------------------------------------------------------
-- 4) STOCK MANUAL (codigos / cuentas de los productos manuales)
--    Cada fila = 1 unidad entregable. El bot entrega la mas antigua sin vender.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_manual (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT REFERENCES products_manual(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,                    -- el codigo/cuenta a entregar
  is_sold       BOOLEAN DEFAULT false,            -- false = disponible / en turno ; true = ya entregado
  sold_to       BIGINT,                           -- Telegram ID del comprador
  sold_at       TIMESTAMPTZ,
  order_id      BIGINT,                           -- numero de orden (orders.id) que consumio esta unidad
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Por si la tabla stock_manual ya existia sin la columna de orden:
ALTER TABLE stock_manual ADD COLUMN IF NOT EXISTS order_id BIGINT;

-- ------------------------------------------------------------
-- 5) ORDENES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                BIGSERIAL PRIMARY KEY,
  telegram_id       BIGINT,                       -- cliente que compro
  product_id        TEXT,                         -- id del producto (API o manual)
  product_name      TEXT,
  quantity          INT DEFAULT 1,
  price             NUMERIC(12,2) DEFAULT 0,      -- precio unitario cobrado
  total             NUMERIC(12,2) DEFAULT 0,      -- total cobrado
  status            TEXT DEFAULT 'processing',    -- processing | paid | delivered | cancelled
  payment_method    TEXT,                         -- balance | binance_pay | bep20
  source            TEXT,                         -- 'kokoro_api' | 'manual'
  delivery_message  TEXT,                         -- contenido entregado
  payment_order_id  TEXT,                         -- id de pago del cliente (Binance Order ID / TXID)
  kokoro_order_id   TEXT,                          -- N° de orden en el BOT PRINCIPAL (para reclamar al proveedor)
  order_code        TEXT,                          -- codigo publico EXE-XXXXXX (letras+numeros, no correlativo)
  created_at        TIMESTAMPTZ DEFAULT now(),
  delivered_at      TIMESTAMPTZ
);

-- Por si la tabla orders ya existia sin el codigo publico:
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_code_uniq ON orders (order_code) WHERE order_code IS NOT NULL;
-- Rellena un codigo a las ordenes viejas que no tengan uno todavia (letras+numeros al azar, sin caracteres ambiguos).
DO $$
DECLARE
  r RECORD;
  chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code TEXT;
BEGIN
  FOR r IN SELECT id FROM orders WHERE order_code IS NULL LOOP
    LOOP
      code := 'EXE-' || (
        SELECT string_agg(substr(chars, (random() * length(chars))::int + 1, 1), '')
        FROM generate_series(1, 6)
      );
      EXIT WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_code = code);
    END LOOP;
    UPDATE orders SET order_code = code WHERE id = r.id;
  END LOOP;
END $$;

-- Renombrar external_order_id -> payment_order_id (si venias de una version anterior):
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='external_order_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_order_id') THEN
    ALTER TABLE orders RENAME COLUMN external_order_id TO payment_order_id;
  END IF;
END $$;
-- Por si la tabla orders ya existia sin estas columnas:
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kokoro_order_id  TEXT;

-- ------------------------------------------------------------
-- 6) TRANSACCIONES (historial de movimientos de saldo)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT,
  type          TEXT,                             -- deposit | purchase | manual_adjust | compensation
  amount        NUMERIC(12,2) DEFAULT 0,          -- + recarga / - compra
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 7) BEP20 PENDIENTES (recargas/compras esperando el deposito)
--    Cada recarga BEP20 genera un MONTO UNICO (decimales aleatorios)
--    que identifica el pago. El poller lo detecta y acredita solo.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bep20_pending (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT,
  type          TEXT DEFAULT 'topup',             -- topup | purchase
  order_id      BIGINT,                           -- si es compra, la orden asociada
  monto_base    NUMERIC(12,4),                    -- monto que pidio el usuario
  monto_unico   NUMERIC(12,4),                    -- monto con decimales aleatorios (identificador)
  status        TEXT DEFAULT 'pending',           -- pending | completed | expired
  expires_at    TIMESTAMPTZ,                      -- vence en X minutos
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 8) TXIDs USADOS (evita acreditar dos veces el mismo deposito)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS binance_payments (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT,
  transaction_id  TEXT UNIQUE,                    -- TXID BEP20 o transactionId de Binance Pay
  amount          NUMERIC(12,4),
  type            TEXT,                           -- topup | purchase
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 9) ACTIVACION POR CORREO (productos que NO se entregan solos)
--    Los productos cuyo nombre este en esta tabla no entregan nada:
--    el bot le pide al cliente un correo, dominio o @usuario para que
--    tu actives el servicio a mano.
--
--    Se administra desde tu GRUPO DE LOGS con los comandos:
--       /correos_add Photoshop 6M     -> ese producto pedira correo
--       /correos_list                 -> ver la lista
--       /correos_del Photoshop 6M     -> vuelve a entrega automatica
--
--    El nombre debe ser EXACTO al del producto en tu tienda.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_activation_products (
  id             BIGSERIAL PRIMARY KEY,
  name_contains  TEXT NOT NULL,                   -- nombre EXACTO del producto
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Evita agregar dos veces el mismo producto (sin importar mayusculas/espacios)
CREATE UNIQUE INDEX IF NOT EXISTS email_activation_products_name_uniq
  ON email_activation_products (lower(trim(name_contains)));

-- ------------------------------------------------------------
-- 10) SEGUIMIENTO DE ACTIVIDAD DEL PANEL ADMIN
--     Registra cada accion importante hecha desde el panel web
--     (para tener un historial/auditoria de lo que se hizo y cuando).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id            BIGSERIAL PRIMARY KEY,
  action        TEXT NOT NULL,                    -- ej: 'product_toggle', 'order_deliver', 'broadcast_sent'
  summary       TEXT NOT NULL,                     -- texto legible de lo que paso
  meta          JSONB,                             -- datos extra (id de la orden, monto, etc.)
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_activity_log_created_idx ON admin_activity_log (created_at DESC);

-- ------------------------------------------------------------
-- 11) TICKETS DE SOPORTE (problemas con ordenes reportados por el cliente)
--     El cliente los crea desde "Mis Compras" -> pedido -> "Reportar un problema".
--     Se administran desde el panel admin (pestaña "الشكاوى").
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  telegram_id   BIGINT NOT NULL,
  description   TEXT NOT NULL,                    -- lo que escribio el cliente
  status        TEXT DEFAULT 'open',              -- open | closed
  admin_reply   TEXT,                             -- respuesta del admin (se envia al cliente al cerrar)
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status, created_at DESC);

-- ------------------------------------------------------------
-- Indices utiles
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bep20_pending_status_idx  ON bep20_pending (status, expires_at);
CREATE INDEX IF NOT EXISTS orders_telegram_id_idx     ON orders (telegram_id);
CREATE INDEX IF NOT EXISTS transactions_tid_idx       ON transactions (telegram_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx       ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx           ON orders (status);
CREATE INDEX IF NOT EXISTS stock_manual_product_idx   ON stock_manual (product_id, is_sold);
CREATE INDEX IF NOT EXISTS products_enabled_idx       ON products (enabled);
CREATE INDEX IF NOT EXISTS products_sort_idx          ON products (sort_order DESC, name);
CREATE INDEX IF NOT EXISTS products_manual_sort_idx   ON products_manual (sort_order DESC, name);

-- ============================================================
--  LISTO. Tu base de datos quedo configurada.
--  Siguiente paso: llena el archivo .env y ejecuta el bot.
--
--  Si ya tenias la base creada de antes, volver a ejecutar este
--  archivo es seguro: solo agrega lo que falte (por ejemplo la
--  tabla nueva del punto 9, activacion por correo).
-- ============================================================
