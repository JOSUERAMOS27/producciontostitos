# Tostitos · Producción y ventas

Sistema web básico para la fábrica de tostones Tostitos: gastos en materia prima y producción, producción por tipo de tostón, ventas y lo que debe cada cliente. Descarga todo en Excel.

## Cómo funciona

- `index.html`: la aplicación completa (no necesita servidor propio).
- `config.js`: la configuración de tu proyecto de Firebase (no es secreta).
- `xlsx.full.min.js`: librería SheetJS 0.18.5 para generar el Excel, servida desde el repositorio.
- `firestore.rules`: reglas para que solo tu correo pueda ver y cambiar los datos.
- `tools/`: de dónde se genera `index.html` (`python3 tools/build_web.py tools/tostitos-artifact.html index.html`).

## Puesta en marcha

1. Crea un proyecto gratis en https://console.firebase.google.com
2. En **Authentication**, activa el proveedor **Google**.
3. En **Firestore Database**, crea la base de datos y pega el contenido de `firestore.rules` en la pestaña **Reglas**, cambiando `TU_CORREO@gmail.com` por tu correo.
4. En **Configuración del proyecto > Tus apps**, agrega una app web y copia `apiKey`, `authDomain`, `projectId` y `appId` en `config.js`.
5. Publica la página con GitHub Pages (Settings > Pages > rama `main`, carpeta raíz) y agrega el dominio `TU_USUARIO.github.io` en Authentication > Settings > Dominios autorizados.

## Versión multiempresa

En la carpeta [`multi/`](multi/) está **Tostones Multi**: las mismas funciones, pero para varias fábricas a la vez, con una base de datos PostgreSQL (Supabase) y sus propias tablas. Mira [`multi/README.md`](multi/README.md).
