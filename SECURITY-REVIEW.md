# Revisión de seguridad — 24 de noviembre de 2026

## Alcance y resultado

Revisión estática limitada del código propio: autenticación, renderizado, exportación CSV, configuración pública, políticas por empresa, permisos y procedimientos de inventario. No se confirmaron vulnerabilidades explotables en las rutas revisadas de la versión base. Esto no certifica la seguridad de toda la aplicación ni del proyecto alojado. La revisión formal conserva la instantánea original; los cambios de MFA se comprobaron después mediante revisión de código, compilación y pruebas locales.

## Controles incorporados

- Correo y contraseña, seguidos de vinculación TOTP y verificación con Google Authenticator.
- El inventario no se monta hasta comprobar la sesión `aal2` y la presencia del endpoint de seguridad de la migración.
- Políticas RLS restrictivas para las ocho tablas de negocio, además de los controles de pertenencia a empresa existentes.
- Comprobación explícita de MFA en los dos procedimientos `security definer`, que pueden omitir RLS por su autoridad de ejecución.
- Ausencia de acceso automático a datos demo cuando Supabase no está configurado.
- Cabeceras CSP, bloqueo de marcos, `nosniff`, política de referente y restricciones de permisos del navegador. La CSP conserva `unsafe-inline` para Next.js y no ofrece las garantías de una política con nonces.

## Evidencia local

- `npm test`: cinco pruebas aprobadas. La prueba de PostgreSQL aplica ambas migraciones con PGlite y comprueba denegación anónima, bloqueo de sesiones AAL1, rechazo de acceso entre empresas, prohibición de escrituras directas de existencias y membresías, idempotencia de entradas y atomicidad de salidas fallidas.
- `npm run check` y `npm run build`: aprobados.
- `npm audit`: cero vulnerabilidades conocidas reportadas para las dependencias instaladas al ejecutar la consulta. No equivale a una auditoría manual de dependencias.
- Petición HTTP a la compilación local: estado 200, aviso de configuración pendiente y cabeceras CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` presentes.

## Pendiente antes de usar datos reales

No hay URL ni clave pública de Supabase configuradas en esta copia. La migración nueva no se ha aplicado a un proyecto remoto. Tampoco se verificaron en vivo el registro, correo de confirmación, TOTP, recuperación, límites de intentos, políticas del proyecto alojado ni persistencia tras recargar. No hubo comprobación visual mediante navegador ni revisión independiente.

El administrador debe conectar el proyecto, aplicar `20261124000000_require_mfa.sql`, habilitar TOTP y confirmación de correo, establecer en Supabase la política de contraseña y controles de abuso, configurar HTTPS y probar dos cuentas reales. El procedimiento de recuperación debe verificar la identidad sin introducir un acceso alternativo que omita MFA. Las instrucciones están en README.md.

Referencia de implementación: [MFA TOTP de Supabase](https://supabase.com/docs/guides/auth/auth-mfa/totp).
