const { createNestApp } = require('../dist/main');

let cachedHandler = null;
let initPromise = null;

async function getHandler() {
  if (cachedHandler) return cachedHandler;
  if (!initPromise) {
    initPromise = createNestApp().then(async ({ app }) => {
      await app.init();
      const expressInstance = app.getHttpAdapter().getInstance();
      cachedHandler = expressInstance;
      return expressInstance;
    });
  }
  return initPromise;
}

module.exports = async function handler(req, res) {
  const appHandler = await getHandler();
  return appHandler(req, res);
};
