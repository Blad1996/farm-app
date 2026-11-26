# Inventory Workspace

Primera versión web de inventario para empresas agrícolas y agroalimentarias. La interfaz usa inglés canadiense y un diseño neutro. Las unidades del catálogo incluyen kg, lb, L, unidades, cajas y sacos.

## Ejecutar en Windows, macOS o Linux

Con Node.js 22 o superior, abre la carpeta del proyecto y ejecuta:

```sh
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Sin variables de Supabase se muestra un aviso de configuración pendiente y no se permite abrir el inventario. El acceso requiere correo, contraseña y un código de Google Authenticator.

## Conectar Supabase y Vercel

1. Aplica las migraciones de `supabase/migrations/` en orden: primero `20261123000000_inventory.sql` en una base nueva y luego `20261124000000_require_mfa.sql`. Si ya aplicaste la primera, ejecuta solamente la segunda. Esta última exige MFA en las políticas RLS y en los procedimientos con privilegios.
2. Copia `.env.example` a `.env.local` y completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con los valores públicos del proyecto. La aplicación usa sesiones y políticas por empresa, por lo que no requiere una clave de servicio.
3. En Supabase Auth configura la URL del sitio y autoriza las URL exactas de redirección que usarás para confirmar correos. Para desarrollo se usa `http://localhost:3000`. Habilita TOTP, la confirmación de correo, una contraseña mínima de 12 caracteres y los controles de abuso disponibles en tu plan. El mínimo del formulario también debe configurarse en Supabase, que recibe las peticiones directas.
4. Importa el repositorio del proyecto en Vercel con el preset de Next.js. Configura ambas variables en el entorno de despliegue y añade el dominio resultante a Supabase Auth. Configura las variables en cada entorno que deba usar la base y separa la base de pruebas de la de producción si vas a probar con datos reales.
5. Pulsa **Crear una cuenta**, confirma tu correo e inicia sesión. Pulsa **Vincular Google Authenticator**, escanea el QR con esa aplicación e introduce el código de seis dígitos. En los siguientes accesos se solicitará el código actual. Después crea el espacio de trabajo, un almacén y un producto para registrar la primera recepción.
6. Verifica con dos cuentas de prueba que no se puede consultar otra empresa, que una sesión sin MFA queda bloqueada y que una entrada persiste después de recargar. La app también comprueba que la migración de MFA esté aplicada antes de abrir el inventario.

## Recuperación y límites de seguridad

El QR y la clave TOTP solo aparecen durante la vinculación y no se guardan en los datos del inventario. Si se pierde el autenticador, el administrador debe verificar la identidad por un canal independiente antes de recuperar la cuenta desde Supabase. No existe un botón que omita el segundo factor. Define y prueba ese procedimiento antes de usar la app con datos reales.

Las pruebas locales ejecutan las migraciones en PostgreSQL con identidades simuladas; no verifican la configuración de tu proyecto alojado ni el envío de correos ni la emisión real de códigos TOTP. Las sesiones del navegador se almacenan mediante el SDK de Supabase. No uses equipos compartidos sin cerrar sesión. La política CSP permite scripts inline para la hidratación de Next.js; no equivale a una política con nonces. Usa HTTPS en el despliegue. Ninguna revisión local garantiza la ausencia de vulnerabilidades.

## Funciones de esta versión

- Dashboard con métricas, alertas visuales y actividad reciente.
- Catálogo de productos con SKU, categoría, unidad y stock mínimo.
- Importación de productos desde CSV con plantilla, vista previa, validación y guardado de todo el lote en una transacción. Fotos privadas por producto, con subida al crearlo y opciones para reemplazarlas o retirarlas desde el catálogo.
- **Crops**, **Irrigation**, **Seed Distribution**, **Farm Expenses**, **Vehicles & Machinery** y **Notifications** para operaciones agrícolas, pagos y mantenimiento. Las alertas aparecen también en Overview. La conexión Gmail permite enviar avisos únicamente al correo verificado del usuario que los active, después de configurar el servidor.
- Almacenes y proveedores. Los proveedores se pueden vincular al recibir lotes.
- Los proveedores incluyen nombre de empresa, teléfono, dirección física y ubicación mediante las listas de país, provincia/estado y ciudad. Para habilitar esos campos en una base existente, aplica `supabase/migrations/20261124010000_supplier_details.sql` después de las migraciones anteriores. Los proveedores existentes se conservan.
- **Purchase Orders:** pedidos de varios productos con proveedor, almacén receptor, fecha esperada, moneda, cantidades, precios unitarios y notas. Borrador, confirmación, recepción parcial/completa y cancelación de cantidades pendientes. Las recepciones por lote generan entradas de inventario y conservan un historial con vencimientos y referencias.
- País, estado/provincia y ciudad se seleccionan mediante listas dependientes al crear un almacén. Cambiar el país limpia las opciones anteriores. Las categorías de producto también son desplegables. Las ubicaciones existentes conservan su formato y no requieren migración.
- Recepción, salida y traslado entre almacenes. Las salidas verifican disponibilidad y vencimiento. El saldo y el historial se guardan juntos.
- Tabla de stock por lote y almacén, búsqueda y exportación CSV de las filas visibles.
- Alta y acceso con Supabase Auth y Google Authenticator obligatorio. Las políticas de PostgreSQL exigen una sesión `aal2` y limitan el acceso a datos de la empresa del usuario; las operaciones privilegiadas comprueban también el segundo factor.

El piloto usa un espacio de trabajo por cuenta en la interfaz. El esquema admite operadores, pero las invitaciones y la gestión de roles desde la interfaz están pendientes. Las salidas del modo conectado evalúan el vencimiento según la fecha de Toronto. El historial de movimientos muestra hasta 500 registros recientes; el historial propio de recepciones conserva el vínculo con sus lotes. La trazabilidad hasta el cliente final queda para una fase posterior.

## Activar Purchase Orders

Aplica `supabase/migrations/20261124020000_purchase_orders.sql` después de las migraciones existentes. No vuelve a crear ni elimina datos de inventario. Si el módulo muestra que no está configurado, falta esa migración. La clave pública de la app no puede aplicar cambios de esquema; se requiere el SQL Editor o un acceso administrativo autorizado de Supabase.

En **Purchase Orders**, pulsa **Create purchase order**, elige proveedor y almacén, agrega las líneas y guarda el borrador. Abre el pedido, pulsa **Confirm order** y usa **Receive** en cada línea para registrar la cantidad entregada, lote y vencimiento. Puedes recibir una línea en varios lotes o entregas. Los estados y saldos se calculan en PostgreSQL, y los reintentos no duplican las recepciones. Una recepción que excede el saldo o falla al crear el lote no modifica el pedido ni las existencias.

Los administradores crean, confirman y cancelan pedidos; administradores y operadores pueden recibirlos. Todas las operaciones exigen MFA y pertenencia a la empresa. La cancelación requiere un motivo y conserva lo ya recibido. Las tablas no permiten escrituras directas desde el cliente. Los totales son antes de impuestos, envío y descuentos, y no actualizan una valoración contable del inventario. Confirmar un pedido no envía mensajes al proveedor. Los borradores se revisan antes de confirmar; para sustituir uno, cancélalo y crea otro.

## Importar productos y subir fotos

Aplica `supabase/migrations/20261124030000_product_import_and_photos.sql` después de las migraciones anteriores. Añade el registro de lotes de importación, la referencia de foto del producto, el bucket privado `product-photos` y sus políticas de acceso. El bucket admite JPEG, PNG y WebP de hasta 5 MB. Los permisos de este bucket incluyen MFA y aislamiento por empresa, incluso si ya existen políticas permisivas para otros buckets. No modifica el acceso a los otros buckets.

En **Inventory → Import CSV**, descarga la plantilla `public/templates/products.csv`. Usa las columnas `name,sku,category,unit,minimum`; `minimum` es opcional y vale 0 si se omite. Las unidades admitidas son `kg`, `lb`, `L`, `ea`, `case`, `bag`. Se aceptan CSV UTF-8 con coma o punto y coma, comillas y saltos de línea dentro de campos. El máximo es 1 MB y 500 productos por importación. La vista previa muestra errores de formato, campos inválidos y SKU repetidos dentro del archivo o ya presentes en el catálogo. Todos los errores deben corregirse antes de importar. La importación crea productos nuevos, no actualiza productos existentes ni añade existencias; registra una recepción para incorporar stock con lote y almacén. El servidor valida otra vez los productos y guarda todo o nada. El ID de importación evita duplicados si se reintenta una petición.

Puedes elegir una foto en **Add product** o usar **Add photo / Change photo** en el catálogo. La app valida el formato del archivo, limita la entrada a 24 megapíxeles y vuelve a codificar la imagen con un lado máximo de 1600 píxeles antes de subirla. No se aceptan SVG ni archivos animados GIF. Las fotos se guardan bajo rutas de empresa y producto; solo los administradores con MFA pueden cambiarlas. Los miembros de esa empresa con MFA pueden verlas mediante enlaces firmados de cinco minutos, que la interfaz renueva mientras está abierta. Las referencias anteriores se retiran antes de intentar borrar el archivo viejo mediante la API de Storage; la política impide borrar una foto todavía vinculada. No se importan enlaces de fotos desde CSV. Si el producto se guarda pero falla la foto, la app lo indica y permite reintentar la foto desde el catálogo.

Las pruebas locales cubren parsing CSV, transacciones de importación, reintentos, validación de metadatos, acceso por empresa, roles, MFA y políticas de Storage. Simulan el esquema de metadatos de Storage en PostgreSQL: no sustituyen una prueba real de subida/descarga en tu proyecto Supabase. Se requiere aplicar la migración y probar las transferencias con una cuenta real. Referencia: [control de acceso de Supabase Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Operaciones agrícolas

Aplica `supabase/migrations/20261126000000_farm_operations.sql` después de las migraciones existentes. Conserva el catálogo y los movimientos anteriores. Las nuevas tablas exigen MFA y pertenencia a la empresa; solo un administrador puede registrar o editar operaciones agrícolas. Los operadores pueden consultarlas. Las operaciones llevan un ID de petición para evitar duplicados al reintentar.

- **Crops:** nombre, tipo, variedad, parcela, superficie en hectáreas/acres/m², fechas de siembra y cosecha esperada, estado y notas. Permite actualizar los datos y el estado.
- **Irrigation:** planificación, método, litros, duración, estado y dinero realmente pagado. Una actividad planificada se puede completar o cancelar. Completarla registra su pago en gastos, una sola vez. Los registros completados se conservan como historial.
- **Seed Distribution:** cultivo destinatario, producto, almacén, lote, cantidad, fecha y equipo/persona receptora. Descuenta stock mediante una salida de inventario y conserva su vínculo con el lote. Bloquea lotes vencidos y cantidades insuficientes. El registro, la salida y el pago se confirman o revierten juntos.
- **Farm Expenses:** pagos manuales y los pagos derivados de riego, semillas, compra de equipos y mantenimiento. Filtros por cultivo, equipo y fechas. Los totales se calculan por moneda; no hay conversión ni suma de monedas distintas. No introduzcas de nuevo pagos ya registrados automáticamente. Estos importes son declaraciones de pagos reales, no una conexión bancaria ni una valoración contable del inventario.
- **Vehicles & Machinery:** registro de vehículos y maquinaria, tipo, matrícula/serie, marca/modelo, estado, importe pagado al comprar, intervalo y siguiente fecha de mantenimiento. Cuenta activos no retirados por categoría. Los pagos de compra existentes son inmutables; registra pagos adicionales por separado en Farm Expenses.
- **Maintenance:** historial de servicios, proveedor, trabajo realizado, pago y próxima fecha. El servicio más reciente actualiza el calendario del activo; un servicio histórico no reemplaza una fecha posterior ya registrada.
- **Notifications:** alertas vencidas y próximas, anticipación de 1–90 días y zona horaria de la finca (por defecto America/Caracas). Conexión Gmail, prueba explícita y preferencias de correo. Las alertas internas no requieren Gmail.

### Conectar Gmail y avisos al correo del usuario

Aplica `20261126010000_verified_user_notifications.sql` después de `20261126000000_farm_operations.sql`. Esta migración desactiva las direcciones provisionales anteriores y vincula la preferencia al ID del usuario. El destinatario se obtiene de `auth.users.email` y se exige correo confirmado y pertenencia actual a la empresa. No se permite escribir destinatarios externos. La cola vuelve a resolver el correo actual antes del envío; no usa la lista de direcciones almacenada como autoridad. Hay una configuración activa de destinatario por empresa: el administrador que guarda las preferencias las vincula a su propia cuenta. Los operadores no pueden cambiarla.

1. Ejecuta `node scripts/generate-email-secrets.mjs` para generar localmente `FARM_EMAIL_ENCRYPTION_KEY` y `CRON_SECRET`, sin imprimirlos ni sobrescribir valores existentes. Están en `.env.local`, que Git ignora. La clave de cifrado debe ser de 32 bytes codificados en Base64. Conserva la misma clave en entornos que comparten las conexiones guardadas; perderla obliga a reconectar Gmail. Usa bases de pruebas separadas cuando corresponda.
2. Reinicia la app. En **Notifications → Connect Gmail**, introduce la cuenta remitente de Gmail/Google Workspace y una contraseña de aplicación de Google de 16 caracteres. No uses tu contraseña normal ni la pegues en el chat. Se verifica la conexión por TLS sin enviar mensajes y se guarda el secreto cifrado con AES-256-GCM y vinculado a la empresa. El formulario nunca devuelve el secreto.
3. Pulsa **Send test to my email** para enviar una prueba únicamente al correo verificado de tu cuenta. Se limita a una prueba por minuto. Conectar Gmail no activa los avisos automáticamente: marca **Email reminders to my verified account** y guarda las preferencias.
4. Para avisos automáticos configura en el servidor/despliegue `SUPABASE_SERVICE_ROLE_KEY`, `FARM_EMAIL_ENCRYPTION_KEY` y `CRON_SECRET`. Ninguno debe llevar prefijo `NEXT_PUBLIC_`. La clave de servicio va solo en el servidor; no se obtiene ni se sustituye por la clave pública. El generador no configura esa clave administrativa.
5. `vercel.json` prepara una ejecución diaria de `/api/cron/farm-alerts` a las 12:00 UTC (08:00 America/Caracas), activada al desplegar con la configuración correspondiente. También puede usarse un programador propio que llame a esa ruta con `Authorization: Bearer <CRON_SECRET>`. Un servidor local sin programador no envía recordatorios automáticamente. Cada ejecución procesa hasta cinco empresas; instalaciones mayores necesitan ajustar la frecuencia/capacidad del programador. La zona horaria de preferencias decide el día y la ventana de las alertas, no la hora de ejecución del programador.

El contenido autorizado del mensaje es únicamente nombre del cultivo o activo, tipo de aviso y fecha/estado próximo o vencido. No incluye importes, notas, existencias, datos de empresa ni credenciales. Los endpoints no aceptan destinatarios, cuerpo de mensaje ni adjuntos arbitrarios. El transporte usa un host fijo de Gmail, TLS con validación de certificado y acceso a archivos/URL deshabilitado. Solo administradores con MFA y correo confirmado pueden configurar Gmail o mandar la prueba.

La cola evita repetir el resumen diario de una empresa. Un resultado SMTP ambiguo se marca **Needs review** y no se reintenta automáticamente, porque el mensaje podría haber sido aceptado. **Accepted by Gmail** significa aceptación SMTP, no garantía de llegada a la bandeja de entrada. Desconectar Gmail desactiva las preferencias; no puede retirar un mensaje ya entregado a SMTP.

Las pruebas usan PostgreSQL local y datos sintéticos, sin conexiones SMTP ni envío real. La prueba de entrega real requiere una cuenta conectada y la acción explícita del usuario. Referencias: [contraseñas de aplicación de Google](https://support.google.com/mail/answer/185833?hl=en), [SMTP seguro en Nodemailer](https://nodemailer.com/smtp) y [Vercel Cron](https://vercel.com/docs/cron-jobs).

## Verificación

```sh
npm test
npm run check
npm run build
```

## Catálogo de ubicaciones

Los archivos públicos de `public/locations/` contienen un catálogo por país derivado de [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database), versión `v5.2.0-export.1`. Esos datos derivados se distribuyen bajo ODbL 1.0, con licencia y atribución en esa carpeta. La app descarga únicamente las opciones del país elegido desde su propio servidor. La cobertura depende del catálogo; si no hay ciudades para una región, se guarda la región y el país seleccionados.

Para regenerar la misma versión del catálogo, ejecuta `node scripts/import-locations.mjs`. No requiere claves ni conexión a Supabase.
