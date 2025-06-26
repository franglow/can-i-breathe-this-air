# Can I Breathe This Air?

## Description

Modern web application to check air quality (AQI) by city or geolocation. The frontend is static (HTML/CSS/JS) and the backend is a secure proxy (Cloudflare Worker) that protects the API key and optimizes performance.

---

## Table of Contents
- [Features](#features)
- [Technologies](#technologies)
- [Project Structure](#project-structure)
- [Installation & Usage](#installation--usage)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Features
- Check AQI by city or current location.
- Accessible, responsive, and fast UI.
- Persistent and in-memory cache (frontend and backend).
- Security: API key is never exposed to the user.
- Loading indicators and clear user messages.
- Automated frontend and backend tests.

## Technologies
- **Frontend:** HTML5, CSS3, JavaScript ES6+, [Vitest](https://vitest.dev/) + jsdom for testing.
- **Backend:** Cloudflare Workers (ESM), Wrangler, [Vitest](https://vitest.dev/) for testing.
- **Infrastructure:** Cloudflare Pages (frontend), Cloudflare Workers (backend).

## Project Structure
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

## Installation & Usage
1. **Clone the repository and enter the directory:**
   ```sh
   git clone <repo-url>
   cd can-i-breathe-this-air
   ```
2. **Install frontend dependencies:**
   ```sh
   npm install
   ```
3. **Install backend dependencies:**
   ```sh
   cd my-air-backend && npm install
   ```
4. **Local development:**
   - Frontend: open `index.html` in your browser or use a static server.
   - Backend: in `my-air-backend`, run `npx wrangler dev`.

## Testing
- **Frontend:**
  ```sh
  npx vitest
  ```
- **Backend:**
  ```sh
  cd my-air-backend && npm test
  ```
- Automated tests with mocks and jsdom for UI and logic.

## Deployment
- **Frontend:** Cloudflare Pages (connect the repo and deploy the root directory).
- **Backend:** Cloudflare Workers (`npx wrangler deploy` in `my-air-backend`).
- Set the API key as a secret in production (`npx wrangler secret put AIR_API_KEY`).

## Contributing
- Pull requests and issues are welcome.
- Follow the code style and add tests for new features.

## License
MIT

---

### Efficiency Notes & Best Practices (2025)
- **Local and Worker cache** to minimize latency and API usage.
- **Async/await** and robust error handling throughout the app.
- **Accessibility**: ARIA, keyboard support, clear messages.
- **Testing**: Automated coverage for frontend and backend.
- **Security**: API key never exposed, secure CORS.
- **Scalability**: Stateless Worker, easy to scale globally.
- **Clean, modular code**: easy to maintain and extend.

---

**Summary:**
Efficient, secure, and modern project, production-ready and easy to maintain or scale.
