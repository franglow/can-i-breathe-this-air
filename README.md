# Can I Breathe This Air?

## Descripción

Aplicación web moderna para consultar la calidad del aire (AQI) por ciudad o geolocalización. El frontend es estático (HTML/CSS/JS) y el backend es un proxy seguro (Cloudflare Worker) que protege la API key y optimiza el rendimiento.

---

## Tabla de Contenidos
- [Características](#características)
- [Tecnologías](#tecnologías)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Instalación y Uso](#instalación-y-uso)
- [Testing](#testing)
- [Despliegue](#despliegue)
- [Contribución](#contribución)
- [Licencia](#licencia)

---

## Características
- Consulta AQI por ciudad o ubicación actual.
- UI accesible, responsiva y rápida.
- Caché persistente y en memoria (frontend y backend).
- Seguridad: la API key nunca se expone al usuario.
- Indicadores de carga y mensajes claros.
- Pruebas automáticas frontend y backend.

## Tecnologías
- **Frontend:** HTML5, CSS3, JavaScript ES6+, [Vitest](https://vitest.dev/) + jsdom para testing.
- **Backend:** Cloudflare Workers (ESM), Wrangler, [Vitest](https://vitest.dev/) para testing.
- **Infraestructura:** Cloudflare Pages (frontend), Cloudflare Workers (backend).

## Estructura del Proyecto
```
├── index.html
├── style.css
├── script.js
├── script.test.js
├── vitest.config.js
├── vitest.setup.js
├── my-air-backend/
│   ├── src/index.js
│   ├── wrangler.toml
│   ├── test/index.spec.js
│   └── vitest.config.js
└── README.md
```

## Instalación y Uso
1. **Clona el repositorio y entra al directorio:**
   ```sh
   git clone <repo-url>
   cd can-i-breathe-this-air
   ```
2. **Instala dependencias (frontend):**
   ```sh
   npm install
   ```
3. **Instala dependencias backend:**
   ```sh
   cd my-air-backend && npm install
   ```
4. **Desarrollo local:**
   - Frontend: abre `index.html` en tu navegador o usa un servidor estático.
   - Backend: en `my-air-backend`, ejecuta `npx wrangler dev`.

## Testing
- **Frontend:**
  ```sh
  npx vitest
  ```
- **Backend:**
  ```sh
  cd my-air-backend && npm test
  ```
- Pruebas automáticas con mocks y jsdom para UI y lógica.

## Despliegue
- **Frontend:** Cloudflare Pages (conecta el repo y despliega la raíz).
- **Backend:** Cloudflare Workers (`npx wrangler deploy` en `my-air-backend`).
- Configura la API key como secreto en producción (`npx wrangler secret put AIR_API_KEY`).

## Contribución
- Pull requests y issues bienvenidos.
- Sigue el estilo de código y agrega pruebas para nuevas funcionalidades.

## Licencia
MIT

---

### Notas de Eficiencia y Buenas Prácticas (2025)
- **Caché local y en Worker** para minimizar latencia y uso de API.
- **Async/await** y manejo de errores robusto en toda la app.
- **Accesibilidad**: ARIA, soporte teclado, mensajes claros.
- **Testing**: Cobertura automatizada frontend y backend.
- **Seguridad**: API key nunca expuesta, CORS seguro.
- **Escalabilidad**: Worker stateless, fácil de escalar globalmente.
- **Código limpio y modular**: fácil de mantener y extender.

---

**Resumen:**
Proyecto eficiente, seguro y moderno, listo para producción y fácil de mantener o escalar.
