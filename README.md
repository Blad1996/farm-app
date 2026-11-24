# Inventory Workspace

Primera versión web de inventario para empresas agrícolas y agroalimentarias. La interfaz usa inglés canadiense y un diseño neutro. Las unidades del catálogo incluyen kg, lb, L, unidades, cajas y sacos.

## Ejecutar en Windows, macOS o Linux

Con Node.js 22 o superior, abre la carpeta del proyecto y ejecuta:

```sh
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Sin variables de Supabase se abre una demostración con datos ficticios. Las modificaciones de la demo se guardan en ese navegador. Para reiniciarla, elimina el almacenamiento local de ese sitio.

## Conectar Supabase y Vercel

1. Crea un proyecto de Supabase y aplica el archivo SQL de `supabase/migrations/` a una base nueva, desde el SQL Editor o tu flujo de migraciones.
2. Copia `.env.example` a `.env.local` y completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con los valores públicos del proyecto. La aplicación usa sesiones y políticas por empresa, por lo que no requiere una clave de servicio.
3. En Supabase Auth configura la URL del sitio y autoriza las URL de redirección que usarás para confirmar correos. Para desarrollo se usa `http://localhost:3000`.
4. Importa el repositorio del proyecto en Vercel con el preset de Next.js. Configura ambas variables en el entorno de despliegue y añade el dominio resultante a Supabase Auth. Configura las variables en cada entorno que deba usar la base y separa la base de pruebas de la de producción si vas a probar con datos reales.
5. Crea una cuenta, confirma el correo si lo solicita Supabase y crea el espacio de trabajo. Agrega un almacén y un producto para registrar la primera recepción.

## Funciones de esta versión

- Dashboard con métricas, alertas visuales y actividad reciente.
- Catálogo de productos con SKU, categoría, unidad y stock mínimo.
- Almacenes y proveedores. Los proveedores se pueden vincular al recibir lotes.
- Recepción, salida y traslado entre almacenes. Las salidas verifican disponibilidad y vencimiento. El saldo y el historial se guardan juntos.
- Tabla de stock por lote y almacén, búsqueda y exportación CSV de las filas visibles.
- En modo conectado, alta y acceso de usuarios con Supabase Auth. Las políticas de PostgreSQL limitan el acceso a datos de la empresa del usuario.

El piloto usa un espacio de trabajo por cuenta en la interfaz. El esquema admite operadores, pero las invitaciones y la gestión de roles desde la interfaz están pendientes. Las salidas del modo conectado evalúan el vencimiento según la fecha de Toronto. El historial visible muestra hasta 500 movimientos recientes. Las órdenes de compra y la trazabilidad hasta el cliente final quedan para una fase posterior.

## Verificación

```sh
node --test tests/inventory.test.mjs
npm run check
npm run build
```
