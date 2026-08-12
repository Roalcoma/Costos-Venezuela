import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ── Configuración de servidores adicionales (servers.json) ───────────────────

interface ServerConfig { host: string; port?: number; instance?: string; user: string; password: string; databases: string[]; }

function _loadServers(): ServerConfig[] {
    const p = path.join(process.env.PROJECT_ROOT || path.join(__dirname, '..'), 'servers.json');
    if (!fs.existsSync(p)) return [];
    try {
        const list = JSON.parse(fs.readFileSync(p, 'utf8')) as any[];
        return list.map(s => ({
            host:      s.host.trim(),
            port:      s.port ? Number(s.port) : undefined,
            instance:  s.instance?.trim() || undefined,
            user:      s.user     || process.env.SA_USER || 'sa',
            password:  s.password || '',
            databases: String(s.databases || '').split(',').map((d: string) => d.trim().toUpperCase()).filter(Boolean),
        }));
    } catch { return []; }
}

const _servers = _loadServers();

/** Devuelve la lista cruda de servidores adicionales (para iterar en login). */
export function getServidoresAdicionalesRaw() { return _servers; }

/** Devuelve el host del servidor adicional al que pertenece dbName, o null si es el primario. */
export function resolverServidor(dbName: string): string | null {
    const upper = dbName.trim().toUpperCase();
    for (const s of _servers) {
        if (s.databases.includes(upper)) return s.host;
    }
    return null;
}

function _configForServer(server: string) {
    const s = _servers.find(x => x.host.trim().toLowerCase() === server.trim().toLowerCase());
    return {
        user:     s?.user     || process.env.SA_USER || 'sa',
        password: s?.password || process.env.SA_PASSWORD,
        ...(s?.port     ? { port: s.port } : {}),
        options:  {
            encrypt: true,
            trustServerCertificate: true,
            ...(s?.instance ? { instanceName: s.instance } : {}),
        },
        pool:     { max: 5, min: 0, idleTimeoutMillis: 30000 }
    };
}

// ── Pools principales (siempre en servidor primario) ─────────────────────────

export const poolPromise = new sql.ConnectionPool({
    ..._configForServer(process.env.SERVER as string),
    server:   process.env.SERVER as string,
    database: 'GESTIONCOMPRASDB',
    pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 }
}).connect()
    .then(p => { console.log('✅ GESTIONCOMPRASDB Conectado'); return p; })
    .catch(err => { console.error('❌ Error GESTIONCOMPRASDB:', err); throw err; });

export const generalPoolPromise = new sql.ConnectionPool({
    ..._configForServer(process.env.SERVER as string),
    server:   process.env.SERVER as string,
    database: 'GENERAL'
}).connect()
    .then(p => { console.log('✅ GENERAL Conectado'); return p; })
    .catch(err => { console.error('❌ Error GENERAL:', err); throw err; });

// ── Cache de pools por marca ──────────────────────────────────────────────────

const brandPools = new Map<string, Promise<sql.ConnectionPool>>();

/**
 * Devuelve el pool de una base de datos de marca.
 * pathBD puede ser:
 *   - "NOMBRE_BD"          → busca en servers.json por databases[]; si no, usa servidor primario
 *   - "servidor:NOMBRE_BD" → usa el servidor del prefijo (compatibilidad con PATHBD de EMPRESAS)
 */
export function getBrandPool(pathBD: string): Promise<sql.ConnectionPool> {
    const hasPrefix = pathBD.indexOf(':') > 0;
    let server: string;
    let dbName: string;

    if (hasPrefix) {
        const i = pathBD.indexOf(':');
        server = pathBD.slice(0, i).trim();
        dbName = pathBD.slice(i + 1).trim().toUpperCase();
    } else {
        dbName = pathBD.trim().toUpperCase();
        server = resolverServidor(dbName) || (process.env.SERVER as string);
    }

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
        return { server: pathBD.slice(0, i).trim(), dbName: pathBD.slice(i + 1).trim().toUpperCase() };
    }
    return { server: process.env.SERVER as string, dbName: pathBD.trim().toUpperCase() };
}

/** Devuelve sólo el nombre de la BD (sin servidor). Usar para prefijos SQL: `${parsearDbName(p)}.DBO`. */
export function parsearDbName(pathBD: string): string { return _parsear(pathBD).dbName; }

/** Alias de parsearDbName para compatibilidad. */
export function parsearPathBD(pathBD: string): string { return parsearDbName(pathBD); }
