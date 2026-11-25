import * as fs from 'fs';
import * as path from 'path';

// In Vercel multi-service builds (`root: "backend"`), @vercel/backends places main.js at
// /var/task/main.js while traced dependencies live under /var/task/backend/node_modules.
// Register that path before loading NestJS modules so both pure-JS and native addons (argon2) resolve.
const backendNodeModules = path.join(__dirname, 'backend', 'node_modules');
if (fs.existsSync(backendNodeModules) && !module.paths.includes(backendNodeModules)) {
  module.paths.unshift(backendNodeModules);
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bootstrap } = require('./bootstrap');

bootstrap().catch((err: unknown) => {
  console.error('Fatal error during application bootstrap:', err);
  process.exit(1);
});
