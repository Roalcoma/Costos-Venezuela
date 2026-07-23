import sql from 'mssql';
import 'dotenv/config';

// Pool principal: GESTIONCOMPRASDB (datos de la app: contenedores, gastos, etc.)
const gestionConfig: sql.config = {
    user: process.env.SA_USER || 'sa',
    password: process.env.SA_PASSWORD || 'R3d3s1pc4..',
    server: process.env.SERVER as string,
    database: 'GESTIONCOMPRASDB',
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

export const poolPromise = new sql.ConnectionPool(gestionConfig)
    .connect()
    .then(pool => { console.log('✅ GESTIONCOMPRASDB Conectado'); return pool; })
    .catch(err => { console.error('❌ Error GESTIONCOMPRASDB:', err); throw err; });

// Pool general: base de datos GENERAL (usuarios, empresas)
const generalConfig: sql.config = {
    user: process.env.SA_USER || 'sa',
    password: process.env.SA_PASSWORD || 'R3d3s1pc4..',
    server: process.env.SERVER as string,
    database: 'GENERAL',
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
};

export const generalPoolPromise = new sql.ConnectionPool(generalConfig)
    .connect()
    .then(pool => { console.log('✅ GENERAL Conectado'); return pool; })
    .catch(err => { console.error('❌ Error GENERAL:', err); throw err; });

// Cache de pools por marca (DB name)
const brandPools = new Map<string, Promise<sql.ConnectionPool>>();

export function getBrandPool(dbName: string): Promise<sql.ConnectionPool> {
    const key = dbName.toUpperCase();
    if (!brandPools.has(key)) {
        const config: sql.config = {
            user: process.env.SA_USER || 'sa',
            password: process.env.SA_PASSWORD || 'R3d3s1pc4..',
            server: process.env.SERVER as string,
            database: key,
            options: { encrypt: true, trustServerCertificate: true },
            pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
        };
        const p = new sql.ConnectionPool(config)
            .connect()
            .then(pool => { console.log(`✅ BD Marca ${key} Conectada`); return pool; })
            .catch(err => { console.error(`❌ Error BD Marca ${key}:`, err); throw err; });
        brandPools.set(key, p);
    }
    return brandPools.get(key)!;
}

// Extrae el nombre de la BD del campo PATHBD (formato "servidor:NOMBRE_BD")
export function parsearPathBD(pathBD: string): string {
    const partes = pathBD.split(':');
    return partes[partes.length - 1].trim().toUpperCase();
}
