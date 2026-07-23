/**
 * hub_receptor.ts — TypeScript / Express o Fastify
 * Hub REDESIPCORE — auto-setup + pull + push
 *
 * ════════════════════════════════════════════════════════
 * ZERO CONFIG: el Hub entrega las credenciales solo
 * ════════════════════════════════════════════════════════
 *
 * 1. El admin registra la app en el Hub con:
 *       context_endpoint = "http://mi-app:3000"
 *
 * 2. El admin llama:
 *       POST /api/db-context/app-token/mi-app
 *
 * 3. El Hub envía automáticamente a esta app:
 *       POST http://mi-app:3000/hub/setup
 *       { hub_url, app_token }
 *
 * 4. Este módulo recibe el setup, guarda los valores
 *    en .hub-config.json y queda listo.
 *
 * 5. La app llama pullCredentials() o recibe pushes.
 *
 * ════════════════════════════════════════════════════════
 * USO MÍNIMO
 * ════════════════════════════════════════════════════════
 *   // server.ts de tu app Express:
 *   import { expressRouter } from './hub_receptor';
 *   app.use(expressRouter);          // expone /hub/setup y /hub/db-context
 *
 *   // Con Fastify:
 *   import { registerFastify } from './hub_receptor';
 *   await registerFastify(fastify);
 *
 *   // En tu startup:
 *   import { pullCredentials } from './hub_receptor';
 *   await pullCredentials();         // obtiene credenciales del Hub
 *
 *   // En tu código:
 *   import { getConnectionUrl } from './hub_receptor';
 *   const url = getConnectionUrl();
 *
 * DEPENDENCIAS: solo módulos nativos (https, crypto, fs). Sin npm extra.
 */

import * as crypto from 'crypto';
import * as https  from 'https';
import * as http   from 'http';
import * as fs     from 'fs';
import * as path   from 'path';

export interface DbCredentials {
  servidor_id: string;
  tipo:        string;
  host:        string;
  puerto:      number;
  db_name:     string;
  usuario:     string;
  password:    string;
  driver?:     string;
}

interface HubConfig {
  hub_url:   string;
  app_token: string;
}

let _context:   DbCredentials | null = null;
let _config:    HubConfig            = { hub_url: '', app_token: '' };
let _setupDone: boolean              = false;

const _CONFIG_FILE = path.resolve('.hub-config.json');


// ─── Persistencia ─────────────────────────────────────────────────────────────

function _cargarConfig(): void {
  // Prioridad: variables de entorno > archivo > vacío
  const hubUrl   = (process.env.HUB_URL       ?? '').replace(/\/$/, '');
  const appToken =  process.env.HUB_APP_TOKEN ?? '';
  if (hubUrl && appToken) {
    _config    = { hub_url: hubUrl, app_token: appToken };
    _setupDone = true;
    return;
  }
  try {
    if (fs.existsSync(_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(_CONFIG_FILE, 'utf8')) as HubConfig;
      _config    = data;
      _setupDone = !!(data.hub_url && data.app_token);
    }
  } catch { /* archivo corrupto o inexistente */ }
}

function _guardarConfig(hubUrl: string, appToken: string): void {
  _config    = { hub_url: hubUrl.replace(/\/$/, ''), app_token: appToken };
  _setupDone = true;
  try {
    fs.writeFileSync(_CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[hub_receptor] No se pudo guardar .hub-config.json: ${(e as Error).message}`);
  }
}

// Cargar config al importar el módulo
_cargarConfig();


// ─── Verificación de firma ─────────────────────────────────────────────────────

function _verifySignature(rawBody: string, signature: string): boolean {
  const appToken = _config.app_token;
  if (!appToken) return false;
  const key      = appToken.length === 64 ? Buffer.from(appToken, 'hex') : Buffer.from(appToken);
  const expected = 'sha256=' + crypto.createHmac('sha256', key).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;   // longitudes distintas
  }
}


// ─── Pull ──────────────────────────────────────────────────────────────────────

export function pullCredentials(opts: { servidorId?: string; dbName?: string } = {}): Promise<DbCredentials> {
  return new Promise((resolve, reject) => {
    if (!_setupDone) {
      return reject(new Error(
        'Hub no configurado. Espera el auto-setup o configura HUB_URL y HUB_APP_TOKEN.'
      ));
    }

    const hubUrl   = _config.hub_url;
    const appToken = _config.app_token;
    const parsed   = new URL(`${hubUrl}/api/db-context/credentials`);

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'GET',
      headers:  { 'X-App-Token': appToken } as Record<string, string>,
    };

    if (opts.servidorId) (options.headers as Record<string, string>)['X-Servidor-Id'] = opts.servidorId;
    if (opts.dbName)     (options.headers as Record<string, string>)['X-Db-Name']     = opts.dbName;

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Hub respondió ${res.statusCode}: ${data}`));
        _context = JSON.parse(data) as DbCredentials;
        resolve(_context);
      });
    });
    req.on('error', reject);
    req.end();
  });
}


// ─── Push + Setup — Express ───────────────────────────────────────────────────

let expressRouter: import('express').Router | undefined;
try {
  const express = require('express') as typeof import('express');
  expressRouter = express.Router();

  // ── /hub/setup — auto-setup TOFU ──────────────────────────────────────────
  expressRouter.post('/hub/setup', express.json(), (req, res) => {
    const forceSetup = req.headers['x-hub-force-setup'] as string | undefined;

    if (_setupDone && forceSetup !== 'true') {
      return res.status(409).json({
        error: 'Setup ya realizado. Usa X-Hub-Force-Setup: true para re-enviar.',
      });
    }

    const body      = req.body as { hub_url?: string; app_token?: string };
    const hub_url   = (body.hub_url   ?? '').trim();
    const app_token = (body.app_token ?? '').trim();

    if (!hub_url || !app_token) {
      return res.status(400).json({ error: "Se requieren 'hub_url' y 'app_token'." });
    }

    _guardarConfig(hub_url, app_token);
    return res.json({ status: 'success', hub_url, mensaje: 'Setup completado.' });
  });

  // ── /hub/db-context — recepción de push ───────────────────────────────────
  expressRouter.post('/hub/db-context', express.text({ type: '*/*' }), (req, res) => {
    const rawBody = req.body as string;
    const sig     = req.headers['x-hub-signature'] as string | undefined;

    if (sig && !_verifySignature(rawBody, sig)) {
      return res.status(401).json({ error: 'Firma X-Hub-Signature inválida.' });
    }

    _context = JSON.parse(rawBody) as DbCredentials;
    return res.json({ status: 'success', db_name: _context.db_name });
  });

  // ── /hub/test — health-check ───────────────────────────────────────────
  expressRouter.get('/hub/test', async (_req, res) => {
    if (!_setupDone) {
      return res.status(503).json({
        ok: false, configured: false,
        error: 'Hub no configurado. Falta HUB_URL y HUB_APP_TOKEN (env o .hub-config.json).',
      });
    }
    try {
      const creds = await pullCredentials();
      const url   = getConnectionUrl();
      return res.json({
        ok: true, configured: true,
        hub_url:        _config.hub_url,
        connection_url: url,
        db_name:        creds.db_name,
        tipo:           creds.tipo,
        servidor_id:    creds.servidor_id,
      });
    } catch (err) {
      return res.status(502).json({
        ok: false, configured: true,
        hub_url: _config.hub_url,
        error:   (err as Error).message,
      });
    }
  });

} catch { /* express no está presente */ }

export { expressRouter };


// ─── Push + Setup — Fastify ───────────────────────────────────────────────────

type FastifyLike = {
  addContentTypeParser: (
    t: string,
    o: object,
    fn: (r: unknown, b: string, d: (e: null, v: string) => void) => void
  ) => void;
  post: (
    path: string,
    opts: object,
    handler: (
      req: { body: string; headers: Record<string, string> },
      reply: { code: (n: number) => { send: (d: unknown) => void } }
    ) => void
  ) => void;
};

export async function registerFastify(fastify: FastifyLike): Promise<void> {
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_r, body, done) => done(null, body));

  // ── /hub/setup — auto-setup TOFU ──────────────────────────────────────────
  fastify.post('/hub/setup', {}, (req, reply) => {
    const forceSetup = req.headers['x-hub-force-setup'];

    if (_setupDone && forceSetup !== 'true') {
      return reply.code(409).send({
        error: 'Setup ya realizado. Usa X-Hub-Force-Setup: true para re-enviar.',
      });
    }

    let body: { hub_url?: string; app_token?: string };
    try {
      body = JSON.parse(req.body);
    } catch {
      return reply.code(400).send({ error: 'Body inválido.' });
    }

    const hub_url   = (body.hub_url   ?? '').trim();
    const app_token = (body.app_token ?? '').trim();

    if (!hub_url || !app_token) {
      return reply.code(400).send({ error: "Se requieren 'hub_url' y 'app_token'." });
    }

    _guardarConfig(hub_url, app_token);
    return reply.code(200).send({ status: 'success', hub_url, mensaje: 'Setup completado.' });
  });

  // ── /hub/db-context — recepción de push ───────────────────────────────────
  fastify.post('/hub/db-context', {}, (req, reply) => {
    const rawBody = req.body;
    const sig     = req.headers['x-hub-signature'];

    if (sig && !_verifySignature(rawBody, sig)) {
      return reply.code(401).send({ error: 'Firma X-Hub-Signature inválida.' });
    }

    _context = JSON.parse(rawBody) as DbCredentials;
    return reply.code(200).send({ status: 'success', db_name: _context.db_name });
  });

  // ── /hub/test — health-check ───────────────────────────────────────────
  fastify.get('/hub/test', {}, async (_req, reply) => {
    if (!_setupDone) {
      return reply.code(503).send({
        ok: false, configured: false,
        error: 'Hub no configurado. Falta HUB_URL y HUB_APP_TOKEN (env o .hub-config.json).',
      });
    }
    try {
      const creds = await pullCredentials();
      const url   = getConnectionUrl();
      return reply.code(200).send({
        ok: true, configured: true,
        hub_url:        _config.hub_url,
        connection_url: url,
        db_name:        (creds as any).db_name,
        tipo:           (creds as any).tipo,
        servidor_id:    (creds as any).servidor_id,
      });
    } catch (err) {
      return reply.code(502).send({
        ok: false, configured: true,
        hub_url: _config.hub_url,
        error:   (err as Error).message,
      });
    }
  });
}


// ─── Helpers ───────────────────────────────────────────────────────────────────

export function getDbContext(): DbCredentials {
  if (!_context) throw new Error('Sin credenciales. Llama pullCredentials() o espera un push.');
  return { ..._context };
}

export function getConnectionUrl(): string {
  const ctx  = getDbContext();
  const tipo = ctx.tipo.toLowerCase();
  const u    = encodeURIComponent(ctx.usuario);
  const p    = encodeURIComponent(ctx.password);
  const h    = ctx.host;
  const port = ctx.puerto;
  const db   = ctx.db_name;

  if (['mssql', 'sqlserver', 'sql server', 'sql_server'].includes(tipo)) return `mssql://${u}:${p}@${h}:${port}/${db}`;
  if (['postgresql', 'postgres'].includes(tipo))                          return `postgresql://${u}:${p}@${h}:${port}/${db}`;
  if (['mysql', 'mariadb'].includes(tipo))                                return `mysql://${u}:${p}@${h}:${port}/${db}`;
  return `${tipo}://${u}:${p}@${h}:${port}/${db}`;
}
