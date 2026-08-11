import sql from 'mssql';
import 'dotenv/config';

const baseConfig = () => ({
    user:     process.env.SA_USER || 'sa',
    password: process.env.SA_PASSWORD,
    options:  { encrypt: true, trustServerCertificate: true },
    pool:     { max: 5, min: 0, idleTimeoutMillis: 30000 }
});

// Pool principal: GESTIONCOMPRASDB
export const poolPromise = new sql.ConnectionPool({
    ...baseConfig(),
    server:   process.env.SERVER as string,
    database: 'GESTIONCOMPRASDB',
    pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 }
}).connect()
    .then(p => { console.log('✅ GESTIONCOMPRASDB Conectado'); return p; })
    .catch(err => { console.error('❌ Error GESTIONCOMPRASDB:', err); throw err; });

// Pool general: GENERAL (usuarios, empresas)
export const generalPoolPromise = new sql.ConnectionPool({
    ...baseConfig(),
    server:   process.env.SERVER as string,
    database: 'GENERAL'
}).connect()
    .then(p => { console.log('✅ GENERAL Conectado'); return p; })
    .catch(err => { console.error('❌ Error GENERAL:', err); throw err; });

// Cache de pools por (servidor::dbname)
const brandPools = new Map<string, Promise<sql.ConnectionPool>>();

/**
 * Conecta a una base de datos de marca.
 * pathBD puede ser "NOMBRE_BD" (usa SERVER del .env) o "servidor:NOMBRE_BD".
 */
export function getBrandPool(pathBD: string): Promise<sql.ConnectionPool> {
    const { server, dbName } = _parsear(pathBD);
    const key = `${server}::${dbName}`;
    if (!brandPools.has(key)) {
        const p = new sql.ConnectionPool({ ...baseConfig(), server, database: dbName })
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
