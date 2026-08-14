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
-- 2) PRODUCTOS (se sincronizan desde la API de KOKORO cada 5 min)
--    El revendedor SOLO configura: markup, enabled y (opcional) emoji.
--    El resto de columnas las actualiza el bot automaticamente.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,                 -- ID del producto en la API KOKORO
  name          TEXT NOT NULL,                    -- nombre (lo trae la API)
  price         NUMERIC(12,2) DEFAULT 0,          -- precio MAYORISTA (lo trae la API)
  stock         INT DEFAULT 0,                    -- stock (lo trae la API)
  min_order     INT DEFAULT 1,                    -- cantidad minima (lo trae la API)
  markup        NUMERIC(6,2) DEFAULT 30,          -- ganancia del revendedor: % o monto fijo segun markup_type (LO CONFIGURA EL REVENDEDOR)
  markup_type   TEXT DEFAULT 'percent',           -- 'percent' (%) o 'fixed' (monto fijo en USDT)
  enabled       BOOLEAN DEFAULT true,             -- true = visible en la tienda (TOGGLE del revendedor)
  emoji         TEXT,                             -- (opcional) forzar un emoji; si esta vacio se detecta por nombre
  custom_name   TEXT,                             -- (opcional) nombre propio del revendedor; si esta vacio se usa el de la API
  description_es TEXT,                            -- descripcion en espanol (la trae la API KOKORO)
  description_en TEXT,                            -- descripcion en ingles (la trae la API KOKORO)
  bulk_discounts JSONB DEFAULT '[]'::jsonb,       -- descuentos por volumen (los trae la API KOKORO)
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Por si la tabla products ya existia sin la columna de nombre propio:
ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_name TEXT;
-- Por si la tabla products ya existia sin el tipo de markup (% o monto fijo):
ALTER TABLE products ADD COLUMN IF NOT EXISTS markup_type TEXT DEFAULT 'percent';
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
  created_at        TIMESTAMPTZ DEFAULT now(),
  delivered_at      TIMESTAMPTZ
);

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
  type          TEXT,                             -- deposit | purchase | manual_adjust
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
-- Indices utiles
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bep20_pending_status_idx  ON bep20_pending (status, expires_at);
CREATE INDEX IF NOT EXISTS orders_telegram_id_idx     ON orders (telegram_id);
CREATE INDEX IF NOT EXISTS transactions_tid_idx       ON transactions (telegram_id);
CREATE INDEX IF NOT EXISTS stock_manual_product_idx   ON stock_manual (product_id, is_sold);
CREATE INDEX IF NOT EXISTS products_enabled_idx       ON products (enabled);

-- ============================================================
--  LISTO. Tu base de datos quedo configurada.
--  Siguiente paso: llena el archivo .env y ejecuta el bot.
--
--  Si ya tenias la base creada de antes, volver a ejecutar este
--  archivo es seguro: solo agrega lo que falte (por ejemplo la
--  tabla nueva del punto 9, activacion por correo).
-- ============================================================
