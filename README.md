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

## Verificación

```sh
npm test
npm run check
npm run build
```

## Catálogo de ubicaciones

Los archivos públicos de `public/locations/` contienen un catálogo por país derivado de [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database), versión `v5.2.0-export.1`. Esos datos derivados se distribuyen bajo ODbL 1.0, con licencia y atribución en esa carpeta. La app descarga únicamente las opciones del país elegido desde su propio servidor. La cobertura depende del catálogo; si no hay ciudades para una región, se guarda la región y el país seleccionados.

Para regenerar la misma versión del catálogo, ejecuta `node scripts/import-locations.mjs`. No requiere claves ni conexión a Supabase.
