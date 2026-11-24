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
- Recepción, salida y traslado entre almacenes. Las salidas verifican disponibilidad y vencimiento. El saldo y el historial se guardan juntos.
- Tabla de stock por lote y almacén, búsqueda y exportación CSV de las filas visibles.
- Alta y acceso con Supabase Auth y Google Authenticator obligatorio. Las políticas de PostgreSQL exigen una sesión `aal2` y limitan el acceso a datos de la empresa del usuario; las operaciones privilegiadas comprueban también el segundo factor.

El piloto usa un espacio de trabajo por cuenta en la interfaz. El esquema admite operadores, pero las invitaciones y la gestión de roles desde la interfaz están pendientes. Las salidas del modo conectado evalúan el vencimiento según la fecha de Toronto. El historial visible muestra hasta 500 movimientos recientes. Las órdenes de compra y la trazabilidad hasta el cliente final quedan para una fase posterior.

## Verificación

```sh
npm test
npm run check
npm run build
```
