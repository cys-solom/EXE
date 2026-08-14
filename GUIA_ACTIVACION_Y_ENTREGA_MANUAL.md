# Guía: Activación por correo y Entrega manual

Esta guía explica dos funciones nuevas de tu bot:

1. **Activación por correo** — productos que en vez de entregarse solos, le piden un dato al cliente (correo, dominio o usuario de Instagram) para que tú los actives a mano.
2. **Entrega manual** — entregarle un producto a un cliente desde tu grupo de logs, con el mismo diseño que una entrega automática.

Todo se maneja desde tu **grupo de logs**. No hay que tocar código.

---

## Antes de empezar

Necesitas dos cosas listas:

**1. Tu grupo de logs configurado.** En tu archivo `.env` debe estar la variable `ADMIN_LOG_GROUP` con el ID del grupo donde el bot te avisa de las compras. Si ya te llegan mensajes de "COMPRA CONFIRMADA", ya lo tienes.

**2. La tabla creada en Supabase.** Es un paso de una sola vez. Se explica abajo.

---

## PASO 1 — Actualizar la base de datos (solo una vez)

Sin este paso, la activación por correo no funciona.

1. Abre el archivo **`setup.sql`** que viene en esta misma carpeta
2. Entra a tu proyecto en [supabase.com](https://supabase.com)
3. En el menú de la izquierda, pulsa **SQL Editor**
4. Pulsa **New query**
5. Copia **todo** el contenido de `setup.sql` y pégalo
6. Pulsa **Run** (o `Ctrl + Enter`)
7. Debe decir **Success**

Listo. Ya puedes usar los comandos.

> **¿Ya tenías la base creada?** No pasa nada: ejecutar `setup.sql` otra vez
> es seguro. Solo agrega lo que falte (en este caso la tabla nueva del
> punto 9) y no borra ni cambia nada de lo que ya tienes.

---

## PASO 2 — Marcar qué productos piden correo

Todos los comandos se escriben **en tu grupo de logs**, no en el chat privado del bot.

### Agregar un producto

```
/correos_add Photoshop 6M
```

El bot responde:

> ✅ Agregado: **Photoshop 6M**
> Ahora ese producto pedirá el correo al cliente en vez de entregarse solo.

⚠️ **El nombre debe ser EXACTO al de tu tienda.** Si tu producto se llama `Photoshop 6M Web`, tienes que escribir `Photoshop 6M Web` completo. Esto es a propósito: evita que se confundan productos con nombres parecidos.

### Ver la lista

```
/correos_list
```

Te muestra todos los productos que están pidiendo correo.

### Quitar un producto

```
/correos_del Photoshop 6M
```

Vuelve a entregarse automáticamente.

---

## PASO 3 — Qué ve el cliente

Cuando alguien compra uno de esos productos, **no recibe credenciales**. Recibe esto:

```
✅ Pago confirmado

📦 Photoshop 6M
💰 5.00 USDT

Tu servicio se activa manualmente. Necesitamos un dato más:
```

Y enseguida:

```
📧 Envíanos los correos que quieres activar:

Ejemplo: user1@gmail.com, user2@gmail.com

⚠️ Deben estar ya registrados en Adobe.
```

El texto **cambia solo** según el producto:

| Si el producto contiene... | Le pide |
|---|---|
| `adobe` o `photoshop` | Correos ya registrados en Adobe |
| `followers`, `instagram`, `tiktok`, `likes`, `views` | Su `@usuario`, con aviso de que la cuenta debe ser pública |
| Cualquier otra cosa | Un correo normal, sin mencionar Adobe |

### El bot valida lo que escribe

Si el cliente escribe algo mal (por ejemplo `no-es-un-correo`), el bot le responde:

> ⚠️ No pude leer ese dato.
> Escríbelo así: **tucorreo@gmail.com**

Y sigue esperando. Así nunca te llega un dato roto.

Si escribe su usuario sin arroba (`miusuario`), el bot le pone la `@` automáticamente.

---

## PASO 4 — Lo que te llega a ti

Cuando el cliente envía el dato, te llega al grupo de logs:

```
📧 DATO RECIBIDO — ACTIVAR

👤 @nombrecliente
🆔 123456789
📦 Photoshop 6M x1
💰 5.00 USDT
🧾 #4972

📧 Correo: user1@gmail.com
```

Ahí tienes todo: quién es, qué compró, cuánto pagó, el número de orden y el dato para activarlo.

El cliente mientras tanto ve:

```
✅ ¡Recibido!

Correo: user1@gmail.com

Ya estamos activando tu servicio.
Te avisamos por aquí en cuanto esté listo.
```

> **Importante:** la orden queda como `paid` (pagada), no como `delivered` (entregada). Así no se cancela sola ni cuenta como entregada hasta que tú la completes.

---

## PASO 5 — Entregarle el producto: `/entregar`

Cuando ya activaste el servicio, le entregas las credenciales desde el grupo de logs.

### Paso a paso

**1.** Escribe:

```
/entregar
```

El bot responde:

> 📦 **Entrega manual**
> Envía el **número de orden** que quieres entregar.

**2.** Envía solo el número (lo ves en el aviso, después del 🧾):

```
4972
```

El bot te muestra la orden para que confirmes que es la correcta:

> 📦 **Orden #4972**
> 👤 Cliente: `123456789`
> 🛍 Producto: **Photoshop 6M**
> 🔢 Cantidad: 1
> 💰 Total: 5.00 USDT
> 📌 Estado: paid
>
> Ahora envía las **credenciales** tal como quieres que las reciba el cliente.

**3.** Escribe las credenciales. Puedes usar varias líneas:

```
correo@ejemplo.com | MiClave123
Perfil: 2
PIN: 4455
```

**4.** El bot se las envía al cliente y te confirma:

> ✅ **Entregado**
> 🧾 Orden #4972
> 👤 Cliente: `123456789`
> 🛍 Photoshop 6M
>
> La orden quedó marcada como **delivered**.

### Lo que recibe el cliente

Exactamente el mismo diseño que una entrega automática. No nota ninguna diferencia:

```
✅ Pago verificado!

🎬 Producto: Photoshop 6M
📦 Orden: #4972
💰 Monto: 5.00 USDT
🌟 Vendedor: TU TIENDA

✅ Orden entregada!

━━━━━━━━━━━━━━━

⚡ Tu producto:

correo@ejemplo.com | MiClave123
Perfil: 2
PIN: 4455
```

Y debajo le aparece su botón para volver a comprar el mismo producto.

### Para salir a mitad del proceso

```
/cancelar
```

---

## Resumen de comandos

Todos se escriben **en el grupo de logs**.

| Comando | Para qué sirve |
|---|---|
| `/correos_add <nombre exacto>` | Marca un producto como "pide correo" |
| `/correos_list` | Ver todos los productos marcados |
| `/correos_del <nombre exacto>` | Quitar un producto de la lista |
| `/entregar` | Entregar una orden a mano |
| `/cancelar` | Salir de la entrega manual |

---

## Preguntas frecuentes

**¿Puedo usar `/entregar` con cualquier orden, aunque no sea de activación por correo?**
Sí. Sirve para cualquier orden: una que falló, una que quedó pendiente, o una que quieras reenviar.

**¿Qué pasa si me equivoco de número de orden?**
El bot te muestra los datos de la orden **antes** de pedirte las credenciales. Si no es la que querías, escribe `/cancelar` y empieza de nuevo.

**¿Y si la orden ya estaba entregada?**
El bot te avisa, pero te deja reenviarla si de verdad quieres.

**¿Qué pasa si el cliente bloqueó el bot?**
El bot te lo dice y **no** marca la orden como entregada. Así no te queda una orden "entregada" que en realidad nunca llegó.

**¿Los clientes pueden usar estos comandos?**
No. Todos comprueban que el mensaje venga de tu grupo de logs. Si un cliente escribe `/entregar` en el chat del bot, no pasa nada.

**¿Tengo que reiniciar el bot al agregar un producto con `/correos_add`?**
No. El cambio aplica en menos de un minuto.

**¿El cliente recibe algo distinto si compra con saldo, Binance Pay o BEP20?**
No. Funciona igual con los tres métodos de pago.

**¿Puedo poner varios correos?**
Sí. El cliente puede enviarlos separados por coma: `uno@gmail.com, dos@gmail.com`. El bot valida que todos sean correos válidos.

---

## Si algo no funciona

**Los comandos no responden:**
Revisa que los estés escribiendo en el grupo de logs y que `ADMIN_LOG_GROUP` esté en tu `.env`.

**`/correos_add` da un error de tabla:**
Falta el PASO 1. Crea la tabla en Supabase.

**El producto se sigue entregando solo:**
El nombre no coincide exacto. Usa `/correos_list` para ver cómo lo guardaste y compáralo con el nombre en tu tienda, letra por letra.

**El cliente dice que no le llegó nada:**
Busca la orden con `/entregar` y su número: ahí ves el estado real. Si dice `paid`, es que falta entregarla.
