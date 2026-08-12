import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ── Credenciales por servidor (servers.json) ─────────────────────────────────

interface ServerCreds { user: string; password: string; }

function _loadServersCreds(): Map<string, ServerCreds> {
    const map = new Map<string, ServerCreds>();
    const p = path.join(process.env.PROJECT_ROOT || path.join(__dirname, '..'), 'servers.json');
    if (!fs.existsSync(p)) return map;
    try {
        const list: Array<{ host: string; user: string; password: string }> = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const s of list) map.set(s.host.trim().toLowerCase(), { user: s.user, password: s.password });
    } catch {}
    return map;
}

const _serversCreds = _loadServersCreds();

function _configForServer(server: string) {
    const creds = _serversCreds.get(server.trim().toLowerCase());
    return {
        user:     creds?.user     || process.env.SA_USER || 'sa',
        password: creds?.password || process.env.SA_PASSWORD,
        options:  { encrypt: true, trustServerCertificate: true },
        pool:     { max: 5, min: 0, idleTimeoutMillis: 30000 }
    };
}

// ── Pool principal: GESTIONCOMPRASDB ─────────────────────────────────────────

export const poolPromise = new sql.ConnectionPool({
    ..._configForServer(process.env.SERVER as string),
    server:   process.env.SERVER as string,
    database: 'GESTIONCOMPRASDB',
    pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 }
}).connect()
    .then(p => { console.log('✅ GESTIONCOMPRASDB Conectado'); return p; })
    .catch(err => { console.error('❌ Error GESTIONCOMPRASDB:', err); throw err; });

// ── Pool general: GENERAL (usuarios, empresas) ────────────────────────────────

export const generalPoolPromise = new sql.ConnectionPool({
    ..._configForServer(process.env.SERVER as string),
    server:   process.env.SERVER as string,
    database: 'GENERAL'
}).connect()
    .then(p => { console.log('✅ GENERAL Conectado'); return p; })
    .catch(err => { console.error('❌ Error GENERAL:', err); throw err; });

// ── Cache de pools por marca (servidor::dbname) ───────────────────────────────

const brandPools = new Map<string, Promise<sql.ConnectionPool>>();

/**
 * Conecta a una base de datos de marca.
 * pathBD puede ser "NOMBRE_BD" (usa SERVER del .env) o "servidor:NOMBRE_BD".
 * Las credenciales se resuelven desde servers.json por servidor; fallback al .env.
 */
export function getBrandPool(pathBD: string): Promise<sql.ConnectionPool> {
    const { server, dbName } = _parsear(pathBD);
    const key = `${server}::${dbName}`;
    if (!brandPools.has(key)) {
        const p = new sql.ConnectionPool({ ..._configForServer(server), server, database: dbName })
            .connect()
            .then(pool => { console.log(`✅ BD ${key} Conectada`); return pool; })
            .catch(err  => { console.error(`❌ Error BD ${key}:`, err); throw err; });
        brandPools.set(key, p);
    }
    return brandPools.get(key)!;
}

// ── Helpers de parseo ────────────────────────────────────────────────────────

function _parsear(pathBD: string): { server: string; dbName: string } {
    const i = pathBD.indexOf(':');
    if (i > 0) {
        return {
            server: pathBD.slice(0, i).trim(),
            dbName: pathBD.slice(i + 1).trim().toUpperCase()
        };
    }
    return {
        server: process.env.SERVER as string,
        dbName: pathBD.trim().toUpperCase()
    };
}

/** Devuelve sólo el nombre de la BD (sin servidor). Usar para prefijos SQL: `${parsearDbName(p)}.DBO`. */
export function parsearDbName(pathBD: string): string {
    return _parsear(pathBD).dbName;
}

/** Alias de parsearDbName para compatibilidad con código existente. */
export function parsearPathBD(pathBD: string): string {
    return parsearDbName(pathBD);
}
