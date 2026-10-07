# Tostones Multi · varias fábricas en una base de datos

La misma idea de Tostitos (gastos, grupos de gastos, producción por tipo de tostón, ventas, clientes y deudas con aviso por WhatsApp, Excel), pero **multiempresa**: muchas fábricas usan el mismo sistema y cada una solo ve sus propios datos. Los datos viven en una base de datos **PostgreSQL** (Supabase) con tablas de verdad.

## Qué trae

- **Fábricas (empresas)**: cada cuenta puede crear una o varias y cambiar entre ellas.
- **Equipo**: el dueño invita por correo a administradores u operadores. Al crear su cuenta con ese correo, entran directo a la fábrica.
- **Gastos**, **grupos de gastos**, **producción** (con costo por unidad y margen), **tipos de tostón**, **ventas** (contado, crédito o pago parcial), **clientes**, **pagos** y **deudas atrasadas** con botón de WhatsApp.
- **Existencias**: lo producido menos lo vendido de cada tipo.
- **Excel** con todo, y **carga de una copia de seguridad** del Tostitos anterior.

## Tablas

| Tabla | Qué guarda |
|---|---|
| `empresas` | Cada fábrica: nombre, moneda, días para avisar deudas |
| `miembros` | Qué usuario está en qué fábrica y con qué rol (`dueno`, `admin`, `operador`) |
| `invitaciones` | Correos invitados a una fábrica que todavía no han entrado |
| `tipos_toston` | Tipos de tostón y su precio normal |
| `clientes` | Clientes, teléfono y si se le avisa cuando debe |
| `gastos` | Compras y gastos, con su código de grupo |
| `producciones` / `produccion_items` | Cada producción y cuántas unidades de cada tipo |
| `ventas` / `venta_items` | Cada venta, cuánto pagó y qué tostones llevó |
| `pagos` | Pagos de clientes a su deuda |

Vistas listas para consultar: `v_ventas` (total y pendiente de cada venta), `v_saldo_clientes` (cuánto debe cada cliente), `v_inventario` (existencias) y `v_grupos_gasto`.

**Aislamiento entre fábricas**: todas las tablas llevan `empresa_id` y tienen *Row Level Security*: la base de datos solo deja ver y cambiar filas de las fábricas donde el usuario es miembro. Además, las líneas de venta y producción tienen llaves foráneas compuestas (`id`, `empresa_id`), así que no se puede usar un cliente o tipo de tostón de otra fábrica ni por error.

## Puesta en marcha

1. Crea un proyecto gratis en https://supabase.com.
2. En **SQL Editor**, pega todo el archivo `schema.sql` y presiona **Run**.
3. En **Authentication > Sign In / Providers**, deja activo **Email**. En **Authentication > URL Configuration**, pon en *Site URL* la dirección donde vas a publicar la página (por ejemplo `https://TU_USUARIO.github.io/producciontostitos/multi/`).
4. En **Project Settings > API**, copia la *Project URL* y la *anon public key* en `config.js`.
5. Publica con GitHub Pages (Settings > Pages > rama `main`, carpeta raíz). La app queda en `https://TU_USUARIO.github.io/producciontostitos/multi/`.

## Archivos

- `index.html`, `app.js`, `estilos.css`: la aplicación (no necesita servidor propio).
- `config.js`: dirección y llave pública de tu proyecto de Supabase.
- `schema.sql`: las tablas, vistas, funciones y permisos. Se puede volver a correr sin perder datos.
- Usa `../xlsx.full.min.js` (SheetJS) del repositorio para el Excel.
