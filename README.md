# 🛍️ KOKORO SHOP LITE

Bot de tienda de Telegram listo para vender. Se conecta a la API de KOKORO como
proveedor mayorista: tú pones tu **markup** por producto y ganas la diferencia.

---

## ✅ Requisitos

- Node.js 18 o superior
- Una cuenta gratis en [Supabase](https://supabase.com)
- Un bot de Telegram (creado con [@BotFather](https://t.me/BotFather))
- Una cuenta de Binance (para recibir pagos)
- **Ser cliente de KOKORO**: generar tu API Key y recargar saldo prepago

---

## 🚀 Instalación (3 pasos)

### 1) Crear las tablas en Supabase
1. Entra a tu proyecto en Supabase → **SQL Editor** → **New query**.
2. Abre el archivo `setup.sql`, copia TODO su contenido y pégalo.
3. Presiona **Run**. Listo: se crean todas las tablas automáticamente.

### 2) Configurar el `.env`
1. Abre el archivo `.env` (ya viene incluido, en blanco).
2. Llena SOLO los valores de arriba (los emojis NO se tocan):

| Variable | De dónde sale |
|----------|----------------|
| `BOT_TOKEN` | @BotFather al crear tu bot |
| `ADMIN_LOG_GROUP` | ID del grupo donde quieres los logs |
| `ADMIN_ID` / `BOT_ADMIN_IDS` | Telegram ID del admin que puede abrir `/admin` en privado |
| `KOKORO_API_KEY` | Bot de KOKORO → 🔗 API LINK → Generar token |
| `SUPABASE_URL` / `SUPABASE_KEY` | Supabase → Project Settings → API |
| `BINANCE_API_KEY` / `BINANCE_SECRET_KEY` | Binance → API Management |
| `BINANCE_PAY_ID` / `BINANCE_PAY_NAME` | Tu Binance Pay |
| `BEP20_WALLET` | Tu dirección de wallet BEP20 (0x...) |

> ⚠️ **Importante:** debes tener **saldo recargado** en tu cuenta KOKORO para
> poder vender. Cada venta descuenta de ese saldo prepago.

### 3) Ejecutar el bot
```bash
node start.js
```
La **primera vez** el bot instala solo lo que necesita (tarda 1-2 minutos) y
luego arranca. Las siguientes veces arranca al instante.

> Si `node start.js` no funciona, prueba con `npm start` (hace lo mismo).

Si todo está bien, verás en la consola:
```
[SYNC] Sincronizacion activa cada 5 min.
[KOKORO] Saldo prepago disponible: XX.XX USDT
✅ KOKORO SHOP LITE iniciado.
```

---

## 🔄 Mantener el bot 24/7 (recomendado)

Si arrancas el bot con `node start.js` en la terminal y **cierras la terminal, el
bot se apaga**. Para que quede prendido **todo el tiempo** (aunque cierres la
terminal, se reinicie el servidor o se caiga), usa **PM2**.

**1) Instala PM2 (una sola vez):**
```bash
npm install -g pm2
```

**2) Arranca el bot con PM2:**
```bash
pm2 start start.js --name mi-bot
```

**3) Que arranque solo cuando se reinicie el servidor (una sola vez):**
```bash
pm2 save
pm2 startup
```
(PM2 te mostrará un comando; cópialo y pégalo tal cual para terminar.)

### Comandos del día a día
| Quiero... | Comando |
|-----------|---------|
| Reiniciar el bot | `pm2 restart mi-bot` |
| Detener el bot | `pm2 stop mi-bot` |
| Ver si está corriendo | `pm2 status` |
| Ver los logs / errores | `pm2 logs mi-bot` |

Con PM2 el bot queda 24/7: si se cae, PM2 lo revive solo; si reinicias el
servidor, arranca solo.

---

## 🧩 Cómo funciona

- Cada **5 minutos** el bot sincroniza los productos de KOKORO (nombre, precio
  mayorista, stock). Tú solo configuras el **markup** y el **toggle** de cada uno.
- El precio que ve el cliente = `precio mayorista × (1 + markup%)`.
- Cuando un cliente compra, el bot le compra a la API de KOKORO y entrega el
  producto automáticamente. Tu ganancia es la diferencia.

### Configurar tus productos (en Supabase → tabla `products`)
- `markup` → tu % de ganancia para ese producto (ej: `30`).
- `enabled` → `true` para mostrarlo, `false` para ocultarlo.
- `emoji` → (opcional) forzar un emoji; si lo dejas vacío se detecta por el nombre.

### Vender tus propios productos (tabla `products_manual`)
1. Agrega una fila en `products_manual` (nombre, precio y descripción en
   `description_es` y `description_en`).
2. Sube tus códigos/cuentas en `stock_manual` (una fila = una unidad; el bot
   entrega la más antigua sin vender). El stock se cuenta solo por esas filas.
3. El bot los entrega automáticamente al comprar.

---

## 💳 Pagos

- **Binance Pay**: el cliente paga a tu Pay ID y pega su Order ID.
- **BEP20 (BSC)**: el cliente envía un monto único a tu wallet; el bot lo detecta
  y acredita solo (o el cliente pega su TXID).

---

## 🆘 Soporte

Cualquier duda con la configuración, contacta a tu proveedor KOKORO.
