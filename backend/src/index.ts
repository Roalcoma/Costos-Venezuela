import express, { Request, Response } from 'express';
import cors from 'cors';
import sql from 'mssql';
import * as dotenv from 'dotenv';
import { poolPromise, generalPoolPromise, getBrandPool, parsearPathBD, parsearDbName, resolverServidor, getServidoresAdicionalesRaw } from './database';
import { authenticate, requireAdmin, generarToken, getDbNamesFromReq, encriptar, TokenPayload } from './auth';
import multer from 'multer';
import * as XLSX from 'xlsx'
import { expressRouter } from './hub_receptor';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import { execSync } from 'child_process';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ─────────────────────────────────────────────
// DDL INICIAL: Tablas y columnas opcionales
// ─────────────────────────────────────────────

(async () => {
    try {
        const pool = await poolPromise;
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='TASAS_CAMBIO' AND xtype='U')
            CREATE TABLE TASAS_CAMBIO (
                ID    INT IDENTITY(1,1) PRIMARY KEY,
                TIPO  NVARCHAR(20)   NOT NULL UNIQUE,
                TASA  DECIMAL(18,4)  NOT NULL,
                FECHA DATETIME       NOT NULL DEFAULT GETDATE()
            )
        `);
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('MAESTRO_GASTOS') AND name='TIPO_TASA')
            ALTER TABLE MAESTRO_GASTOS ADD TIPO_TASA NVARCHAR(20) NOT NULL DEFAULT 'BCV'
        `);
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('GASTOSCONTENEDOR') AND name='TASA_CAMBIO')
            ALTER TABLE GASTOSCONTENEDOR ADD TASA_CAMBIO DECIMAL(18,4) NULL
        `);
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('GASTOSCONTENEDOR') AND name='FECHA_PAGO')
            ALTER TABLE GASTOSCONTENEDOR ADD FECHA_PAGO DATE NULL
        `);
    } catch { /* silencioso */ }
})();

// Cache de metadata de MAESTRO_GASTOS — evita sys.columns en cada request
let _maestroMeta: { pkCol: string; tipoTasa: boolean } | null = null;
async function getMaestroMeta(): Promise<{ pkCol: string; tipoTasa: boolean }> {
    if (_maestroMeta) return _maestroMeta;
    const pool = await poolPromise;
    const colsRes = await pool.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('MAESTRO_GASTOS')`);
    const cols = colsRes.recordset.map((r: any) => String(r.name).toUpperCase());
    _maestroMeta = {
        pkCol: cols.includes('ID') ? 'ID' : (cols.find((c: string) => c.includes('ID')) || 'ID'),
        tipoTasa: cols.includes('TIPO_TASA')
    };
    return _maestroMeta;
}

// ─────────────────────────────────────────────
// AUTH: Login y Empresas
// ─────────────────────────────────────────────

app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
        const { usuario, password } = req.body;
        if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

        const gPool = await generalPoolPromise;

        // Encripta la contraseña ingresada con el algoritmo ICG y compara con NEWPASS
        const passEncriptado = encriptar(password);

        const userResult = await gPool.request()
            .input('usr', sql.NVarChar, usuario)
            .input('pass', sql.NVarChar, passEncriptado)
            .query(`
                SELECT CODUSUARIO, USUARIO
                FROM USUARIOS
                WHERE USUARIO = @usr
                  AND NEWPASS = @pass
                  AND ISNULL(BLOQUEADO, 'F') = 'F'
                  AND ISNULL(DESCATALOGADO, 'F') = 'F'
            `);

        if (userResult.recordset.length === 0) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        const user = userResult.recordset[0];

        // Empresas accesibles para este usuario (servidor primario)
        const empresasResult = await gPool.request()
            .input('cod', sql.Int, user.CODUSUARIO)
            .query(`
                SELECT E.CODEMPRESA, E.TITULO, E.PATHBD
                FROM EMPRESAS E
                INNER JOIN EMPRESASUSUARIO EU ON EU.CODEMPRESA = E.CODEMPRESA
                WHERE EU.CODUSUARIO = @cod
                  AND ISNULL(E.PATHBD, '') <> ''
                ORDER BY EU.POSICION
            `);

        const excluidas = (process.env.MARCAS_EXCLUIDAS || '')
            .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

        const empresas: Array<{ codempresa: number; titulo: string; dbName: string; pathBD: string }> =
            empresasResult.recordset
                .map((e: any) => ({
                    codempresa: e.CODEMPRESA,
                    titulo: e.TITULO,
                    dbName: parsearDbName(e.PATHBD),
                    pathBD: e.PATHBD
                }))
                .filter((e: any) => !excluidas.includes(e.dbName.toUpperCase()));

        // Empresas de servidores secundarios (GENERAL propio en cada servidor adicional)
        console.log('[LOGIN] Servidores adicionales:', getServidoresAdicionalesRaw().map(s => s.host));
        for (const srv of getServidoresAdicionalesRaw()) {
            try {
                console.log('[LOGIN] Consultando GENERAL en:', srv.host);
                const secPool = await getBrandPool(`${srv.host}:GENERAL`);
                const secResult = await secPool.request()
                    .input('usr', sql.NVarChar, usuario)
                    .query(`
                        SELECT E.CODEMPRESA, E.TITULO, E.PATHBD
                        FROM EMPRESAS E
                        INNER JOIN EMPRESASUSUARIO EU ON EU.CODEMPRESA = E.CODEMPRESA
                        INNER JOIN USUARIOS U ON U.CODUSUARIO = EU.CODUSUARIO
                        WHERE U.USUARIO = @usr
                          AND ISNULL(E.PATHBD, '') <> ''
                        ORDER BY EU.POSICION
                    `);
                for (const e of secResult.recordset) {
                    const dbName = parsearDbName(e.PATHBD);
                    if (excluidas.includes(dbName.toUpperCase())) continue;
                    if (empresas.some(x => x.dbName.toUpperCase() === dbName.toUpperCase())) continue;
                    empresas.push({ codempresa: e.CODEMPRESA, titulo: e.TITULO, dbName, pathBD: e.PATHBD });
                }
            } catch (secErr: any) { console.warn('[LOGIN] Error servidor secundario:', srv.host, secErr?.message); }
        }

        const pool = await poolPromise;

        // ¿Es admin?
        const adminCheck = await pool.request()
            .input('usr', sql.NVarChar, user.USUARIO)
            .query('SELECT 1 AS ES_ADMIN FROM USUARIOS_ADMIN WHERE USUARIO = @usr');
        const isAdmin = adminCheck.recordset.length > 0;

        // Permisos explícitos (si no tiene ninguno → acceso total por defecto)
        const permisosResult = await pool.request()
            .input('usr', sql.NVarChar, user.USUARIO)
            .query('SELECT PERMISO FROM PERMISOS_USUARIO WHERE USUARIO = @usr');
        const permisos: string[] = isAdmin
            ? ['REPORTES', 'GESTION']
            : permisosResult.recordset.length > 0
                ? permisosResult.recordset.map((r: any) => r.PERMISO)
                : ['REPORTES', 'GESTION']; // default: acceso completo si no hay restricciones

        const payload: TokenPayload = {
            codusuario: user.CODUSUARIO,
            usuario: user.USUARIO,
            empresas,
            isAdmin,
            permisos
        };

        const token = generarToken(payload);
        res.json({ token, usuario: user.USUARIO, empresas, isAdmin });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/auth/empresas', authenticate, async (req: Request, res: Response) => {
    const user: TokenPayload = (req as any).user;
    res.json({ empresas: user.empresas });
});

// ─────────────────────────────────────────────
// CONTENEDORES
// ─────────────────────────────────────────────

// Listar todos los contenedores registrados en la app
app.get('/api/contenedores', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`
                SELECT C.*,
                    STUFF((SELECT ', ' + CM.MARCA
                           FROM CONTENEDOR_MARCAS CM
                           WHERE CM.CONTENEDORID = C.CONTENEDORID
                           FOR XML PATH(''), TYPE).value('.','NVARCHAR(MAX)'), 1, 2, '') AS MARCAS,
                    (SELECT COUNT(*) FROM GASTOSCONTENEDOR G WHERE G.CONTENEDORID = C.CONTENEDORID) AS GASTOS_COUNT,
                    STUFF((SELECT ' | ' + G.NOMBREGASTO + ': $' + CAST(CAST(G.IMPORTE AS DECIMAL(18,2)) AS NVARCHAR(50))
                           FROM GASTOSCONTENEDOR G
                           WHERE G.CONTENEDORID = C.CONTENEDORID
                           FOR XML PATH(''), TYPE).value('.','NVARCHAR(MAX)'), 1, 3, '') AS GASTOS_DETALLE
                FROM CONTENEDORES C
                ORDER BY C.CREATEDAT DESC
            `);
        res.json(result.recordset);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Detalle de un contenedor con sus gastos
app.get('/api/contenedores/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT C.*, G.GASTOID, G.NOMBREGASTO, G.IMPORTE, G.FACTOR, G.CODIGO_ERP, G.MARCA AS GASTO_MARCA, G.DB_NAME AS GASTO_DB,
                    STUFF((SELECT ', ' + CM.MARCA
                           FROM CONTENEDOR_MARCAS CM
                           WHERE CM.CONTENEDORID = C.CONTENEDORID
                           FOR XML PATH(''), TYPE).value('.','NVARCHAR(MAX)'), 1, 2, '') AS MARCAS
                FROM CONTENEDORES C
                LEFT JOIN GASTOSCONTENEDOR G ON C.CONTENEDORID = G.CONTENEDORID
                WHERE C.CONTENEDORID = @id
            `);

        if (result.recordset.length === 0) return res.status(404).send();
        const contenedor = { ...result.recordset[0], gastos: result.recordset.filter(r => r.GASTOID) };
        res.json(contenedor);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Crear contenedor — busca el FOB sumando sobre todas las marcas accesibles
app.post('/api/contenedores', authenticate, async (req: Request, res: Response) => {
    try {
        const c = req.body;
        const dbNames = getDbNamesFromReq(req);
        const pool = await poolPromise;

        // Calcula VALOR_USS sumando las compras China (Serie Z) en todas las marcas
        let totalValorUSS = 0;
        const marcasConDatos: Array<{ marca: string; dbName: string }> = [];

        for (const dbName of dbNames) {
            try {
                const bPool = await getBrandPool(dbName);
                const DBO = `${dbName}.DBO`;
                const valResult = await bPool.request()
                    .input('num', sql.NVarChar, c.NUMEROCONTENEDOR)
                    .query(`;WITH CTE_COSTE_CHINA AS (
                        SELECT
                            ACL.UNIDADESTOTAL * (
                                SELECT DISTINCT ACL2.PRECIO
                                FROM ${DBO}.ALBCOMPRACAMPOSLIBRES ACCL2
                                INNER JOIN ${DBO}.ALBCOMPRALIN ACL2 ON ACCL2.NUMALBARAN = ACL2.NUMALBARAN
                                    AND ACCL2.NUMSERIE = ACL2.NUMSERIE AND ACCL2.N = ACL2.N
                                WHERE ACCL2.CONTENEDOR = ACCL.CONTENEDOR
                                    AND ACL2.NUMSERIE LIKE 'Z%'
                                    AND ACL2.CODARTICULO = ACL.CODARTICULO
                            ) AS TOTAL
                        FROM ${DBO}.ALBCOMPRALIN ACL
                        INNER JOIN ${DBO}.ALBCOMPRACAMPOSLIBRES ACCL ON ACCL.NUMALBARAN = ACL.NUMALBARAN
                            AND ACCL.NUMSERIE = ACL.NUMSERIE AND ACCL.N = ACL.N
                        WHERE ACL.NUMSERIE LIKE 'Z%' AND ACCL.CONTENEDOR LIKE @num
                    )
                    SELECT ISNULL(SUM(TOTAL), 0) AS TOTAL FROM CTE_COSTE_CHINA`);

                const total = Number(valResult.recordset[0]?.TOTAL || 0);
                if (total > 0) {
                    totalValorUSS += total;
                    marcasConDatos.push({ marca: dbName, dbName });
                }
            } catch { /* BD de marca no disponible, omitir */ }
        }

        // Inserta el contenedor
        const result = await pool.request()
            .input('num', sql.NVarChar, c.NUMEROCONTENEDOR)
            .input('bl', sql.NVarChar, c.BILLOFLADING)
            .input('buque', sql.NVarChar, c.BUQUE_VIAJE)
            .input('status', sql.NVarChar, c.ESTATUS)
            .input('tam', sql.NVarChar, c.TAMANO)
            .input('imp', sql.NVarChar, c.IMPORTADOR)
            .input('pro', sql.NVarChar, c.PROCEDENCIA)
            .input('fac', sql.NVarChar, c.NUMEROFACTURA)
            .input('val', sql.Decimal(18, 2), totalValorUSS || c.VALOR_USS || 0)
            .input('bul', sql.Int, c.BULTOS)
            .input('etd', sql.Date, c.FECHASALIDA_ETD)
            .input('eta', sql.Date, c.FECHALLEGADA_ETA)
            .input('obs', sql.NVarChar, c.OBSERVACIONES)
            .query(`
                INSERT INTO CONTENEDORES (NUMEROCONTENEDOR, BILLOFLADING, BUQUE_VIAJE, ESTATUS, TAMANO, IMPORTADOR, PROCEDENCIA, NUMEROFACTURA, VALOR_USS, BULTOS, FECHASALIDA_ETD, FECHALLEGADA_ETA, OBSERVACIONES)
                OUTPUT INSERTED.CONTENEDORID
                VALUES (@num, @bl, @buque, @status, @tam, @imp, @pro, @fac, @val, @bul, @etd, @eta, @obs)
            `);

        const contenedorId = result.recordset[0].CONTENEDORID;

        // Registra qué marcas tienen datos para este contenedor
        for (const m of marcasConDatos) {
            await pool.request()
                .input('cid', sql.Int, contenedorId)
                .input('marca', sql.NVarChar, m.marca)
                .input('db', sql.NVarChar, m.dbName)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM CONTENEDOR_MARCAS WHERE CONTENEDORID = @cid AND DB_NAME = @db)
                    INSERT INTO CONTENEDOR_MARCAS (CONTENEDORID, MARCA, DB_NAME) VALUES (@cid, @marca, @db)
                `);
        }

        res.status(201).json({ CONTENEDORID: contenedorId, MARCAS: marcasConDatos });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Eliminar contenedor
app.delete('/api/contenedores/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                DELETE FROM GASTOSCONTENEDOR WHERE CONTENEDORID = @id
                DELETE FROM CONTENEDOR_MARCAS WHERE CONTENEDORID = @id
                DELETE FROM CONTENEDORES WHERE CONTENEDORID = @id
            `);
        res.status(200).json({ success: true, message: 'Eliminado correctamente' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// LISTA DE CONTENEDORES DISPONIBLES (desde ERP multi-marca)
// ─────────────────────────────────────────────

app.get('/api/listacontenedores', authenticate, async (req: Request, res: Response) => {
    try {
        const dbNames = getDbNamesFromReq(req);
        const todos: Set<string> = new Set();

        for (const dbName of dbNames) {
            try {
                const bPool = await getBrandPool(dbName);
                const DBO = `${dbName}.DBO`;
                const result = await bPool.request()
                    .query(`SELECT DISTINCT CONTENEDOR FROM ${DBO}.ALBCOMPRACAMPOSLIBRES WHERE ISNULL(CONTENEDOR, '') <> ''`);
                result.recordset.forEach(r => todos.add(r.CONTENEDOR));
            } catch { /* BD no disponible */ }
        }

        res.status(200).json({ success: true, contenedores: Array.from(todos).map(c => ({ CONTENEDOR: c })) });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// GASTOS
// ─────────────────────────────────────────────

app.post('/api/gastos', authenticate, async (req: Request, res: Response) => {
    try {
        const { CONTENEDORID, NOMBREGASTO, IMPORTE, FACTOR, MAESTRO_GASTO_ID, CODIGO_ERP, MARCA, DB_NAME, TASA_CAMBIO, FECHA_PAGO } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('cid',   sql.Int,           CONTENEDORID)
            .input('nom',   sql.NVarChar,       NOMBREGASTO)
            .input('imp',   sql.Decimal(18, 4), IMPORTE)
            .input('fac',   sql.Decimal(10, 6), FACTOR)
            .input('mid',   sql.Int,            MAESTRO_GASTO_ID)
            .input('erp',   sql.NVarChar,       CODIGO_ERP)
            .input('marca', sql.NVarChar,       MARCA || null)
            .input('db',    sql.NVarChar,       DB_NAME || null)
            .input('tasa',  sql.Decimal(18, 4), TASA_CAMBIO != null ? Number(TASA_CAMBIO) : null)
            .input('fecha', sql.NVarChar,       FECHA_PAGO || null)
            .query(`
                INSERT INTO GASTOSCONTENEDOR (CONTENEDORID, NOMBREGASTO, IMPORTE, FACTOR, MAESTRO_GASTO_ID, CODIGO_ERP, MARCA, DB_NAME, TASA_CAMBIO, FECHA_PAGO)
                VALUES (@cid, @nom, @imp, @fac, @mid, @erp, @marca, @db, @tasa, @fecha)
            `);
        res.status(201).json({ message: 'Gasto guardado correctamente' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.put('/api/gastos/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const { IMPORTE, FACTOR, DESCRIPCIONGASTO } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('imp', sql.Decimal(18, 4), IMPORTE)
            .input('fac', sql.Decimal(10, 6), FACTOR)
            .input('desc', sql.NVarChar, DESCRIPCIONGASTO)
            .query(`UPDATE GASTOSCONTENEDOR SET IMPORTE = @imp, FACTOR = @fac, DESCRIPCIONGASTO = @desc WHERE GASTOID = @id`);
        res.json({ message: 'Gasto actualizado correctamente.' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/gastos/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const checkStatus = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT C.ESTATUS FROM GASTOSCONTENEDOR G JOIN CONTENEDORES C ON G.CONTENEDORID = C.CONTENEDORID WHERE G.GASTOID = @id');

        if (checkStatus.recordset[0]?.ESTATUS === 'PROCESADO') {
            return res.status(403).json({ error: 'No se puede eliminar un gasto de un contenedor ya procesado.' });
        }
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM GASTOSCONTENEDOR WHERE GASTOID = @id');
        res.json({ message: 'Gasto eliminado correctamente.' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// DATOS ERP MULTI-MARCA (compras, ventas, tiendas)
// ─────────────────────────────────────────────

// Helper: obtiene los DB names del contenedor desde CONTENEDOR_MARCAS (o usa las del usuario si no hay)
async function getDbNamesDeContenedor(contenedorId: number, userDbNames: string[]): Promise<string[]> {
    const pool = await poolPromise;
    const r = await pool.request()
        .input('cid', sql.Int, contenedorId)
        .query('SELECT DISTINCT DB_NAME FROM CONTENEDOR_MARCAS WHERE CONTENEDORID = @cid');
    if (r.recordset.length > 0) {
        return r.recordset.map((x: any) => x.DB_NAME);
    }
    return userDbNames;
}

app.get('/api/comprasgeneral/:contenedor', authenticate, async (req: Request, res: Response) => {
    try {
        const pathBDs = getDbNamesFromReq(req);
        const resultados = (await Promise.all(pathBDs.map(async (pathBD) => {
            try {
                const bPool = await getBrandPool(pathBD);
                const dbName = parsearDbName(pathBD);
                const DBO = `${dbName}.DBO`;
                const result = await bPool.request()
                    .input('contenedor', sql.NVarChar, req.params.contenedor)
                    .query(`
                        SELECT
                            CONCAT(ACC.NUMSERIE, ' - ', ACC.NUMALBARAN) DOCUMENTO,
                            ACC.FECHAALBARAN FECHA,
                            ACC.TOTALBRUTO,
                            ACC.TOTALNETO,
                            ACCL.CONTENEDOR,
                            '${dbName}' AS MARCA
                        FROM ${DBO}.ALBCOMPRACAB ACC
                        INNER JOIN ${DBO}.ALBCOMPRACAMPOSLIBRES ACCL
                            ON ACCL.NUMALBARAN = ACC.NUMALBARAN AND ACCL.NUMSERIE = ACC.NUMSERIE AND ACCL.N = ACC.N
                        WHERE ISNULL(ACCL.CONTENEDOR, '') <> ''
                            AND ACC.NUMSERIE LIKE 'Z%'
                            AND ACCL.CONTENEDOR LIKE @contenedor
                    `);
                return result.recordset;
            } catch { return []; }
        }))).flat();
        res.json(resultados);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/ventastiendas/:contenedor', authenticate, async (req: Request, res: Response) => {
    try {
        const pathBDs = getDbNamesFromReq(req);

        const resultados = (await Promise.all(pathBDs.map(async (pathBD) => {
            try {
                await updateContenedorEnMarca(req.params.contenedor as string, pathBD);
                const bPool = await getBrandPool(pathBD);
                const dbName = parsearDbName(pathBD);
                const DBO = `${dbName}.DBO`;
                const result = await bPool.request()
                    .input('contenedor', sql.NVarChar, req.params.contenedor)
                    .query(`;WITH CTE_COMPRAS_PRECIOS AS (
                        SELECT ACCL2.CONTENEDOR, ACL2.CODARTICULO, MAX(ACL2.PRECIO) AS PRECIO_COMPRA
                        FROM ${DBO}.ALBCOMPRALIN ACL2
                        INNER JOIN ${DBO}.ALBCOMPRACAMPOSLIBRES ACCL2
                            ON ACCL2.NUMALBARAN = ACL2.NUMALBARAN AND ACCL2.NUMSERIE = ACL2.NUMSERIE AND ACCL2.N = ACL2.N
                        WHERE ACL2.NUMSERIE LIKE 'Z%' AND ACCL2.CONTENEDOR = @contenedor
                        GROUP BY ACCL2.CONTENEDOR, ACL2.CODARTICULO
                    ),
                    CTE_COSTE_CHINA AS (
                        SELECT ACL.NUMSERIE, ACL.NUMALBARAN,
                            SUM(ACL.UNIDADESTOTAL * ISNULL(CP.PRECIO_COMPRA, 0)) AS TOTAL_ALBARAN
                        FROM ${DBO}.ALBVENTALIN ACL
                        INNER JOIN ${DBO}.ALBVENTACAMPOSLIBRES ACCL
                            ON ACCL.NUMALBARAN = ACL.NUMALBARAN AND ACCL.NUMSERIE = ACL.NUMSERIE AND ACCL.N = ACL.N
                        LEFT JOIN CTE_COMPRAS_PRECIOS CP ON CP.CODARTICULO = ACL.CODARTICULO AND CP.CONTENEDOR = ACCL.CONTENEDOR
                        WHERE ACL.NUMSERIE LIKE 'Z%' AND ACCL.CONTENEDOR = @contenedor
                        GROUP BY ACL.NUMSERIE, ACL.NUMALBARAN
                    ),
                    CTE_TOTAL_CONTENEDOR AS (
                        SELECT SUM(ACL.UNIDADESTOTAL * ISNULL(CP.PRECIO_COMPRA, 0)) AS TOTAL_GLOBAL
                        FROM ${DBO}.ALBCOMPRALIN ACL
                        INNER JOIN ${DBO}.ALBCOMPRACAMPOSLIBRES ACCL
                            ON ACCL.NUMALBARAN = ACL.NUMALBARAN AND ACCL.NUMSERIE = ACL.NUMSERIE AND ACCL.N = ACL.N
                        LEFT JOIN CTE_COMPRAS_PRECIOS CP ON CP.CODARTICULO = ACL.CODARTICULO AND CP.CONTENEDOR = ACCL.CONTENEDOR
                        WHERE ACL.NUMSERIE LIKE 'Z%' AND ACCL.CONTENEDOR = @contenedor
                    )
                    SELECT
                        CONCAT(AVC.NUMSERIE, ' - ', AVC.NUMALBARAN) AS DOCUMENTO,
                        AVC.FECHA,
                        AVC.TOTALBRUTO,
                        AVC.TOTALNETO,
                        ROUND(ISNULL(C.TOTAL_ALBARAN, 0), 2) AS COSTO_REAL_CHINA,
                        ROUND((ISNULL(C.TOTAL_ALBARAN, 0) * 100.0) / NULLIF(T.TOTAL_GLOBAL, 0), 2) AS PORCENTAJE_CONTENEDOR,
                        AVCL.CONTENEDOR,
                        AVC.NORECIBIDO,
                        '${dbName}' AS MARCA
                    FROM ${DBO}.ALBVENTACAB AVC
                    INNER JOIN ${DBO}.ALBVENTACAMPOSLIBRES AVCL
                        ON AVCL.NUMALBARAN = AVC.NUMALBARAN AND AVCL.NUMSERIE = AVC.NUMSERIE AND AVCL.N = AVC.N
                    LEFT JOIN CTE_COSTE_CHINA C ON C.NUMSERIE = AVC.NUMSERIE AND C.NUMALBARAN = AVC.NUMALBARAN
                    CROSS JOIN CTE_TOTAL_CONTENEDOR T
                    WHERE AVC.NUMSERIE LIKE 'Z%' AND AVCL.CONTENEDOR = @contenedor
                `);
                return result.recordset;
            } catch { return []; }
        }))).flat();

        // Calcular % sobre el total del contenedor (suma TOTALNETO albaranes Z de todas las marcas)
        const totalContenedor = (await Promise.all(pathBDs.map(async (pathBD) => {
            try {
                const bPool = await getBrandPool(pathBD);
                const r = await bPool.request()
                    .input('contenedor', sql.NVarChar, req.params.contenedor)
                    .query(`
                        SELECT ISNULL(SUM(ACC.TOTALNETO), 0) AS TOTAL
                        FROM ALBCOMPRACAB ACC
                        INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL
                            ON ACCL.NUMALBARAN = ACC.NUMALBARAN AND ACCL.NUMSERIE = ACC.NUMSERIE AND ACCL.N = ACC.N
                        WHERE ACC.NUMSERIE LIKE 'Z%' AND ACCL.CONTENEDOR = @contenedor
                    `);
                return Number(r.recordset[0]?.TOTAL || 0);
            } catch { return 0; }
        }))).reduce((a, b) => a + b, 0);

        const resultadosConPct = resultados.map(r => ({
            ...r,
            PORCENTAJE_CONTENEDOR: totalContenedor > 0
                ? Math.round((Number(r.COSTO_REAL_CHINA || 0) * 10000) / totalContenedor) / 100
                : 0
        }));

        res.json(resultadosConPct);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/comprastiendas/:contenedor', authenticate, async (req: Request, res: Response) => {
    try {
        const pathBDs = getDbNamesFromReq(req);
        const resultados = (await Promise.all(pathBDs.map(async (pathBD) => {
            try {
                const bPool = await getBrandPool(pathBD);
                const dbName = parsearDbName(pathBD);
                const DBO = `${dbName}.DBO`;
                const result = await bPool.request()
                    .input('contenedor', sql.NVarChar, req.params.contenedor)
                    .query(`
                        SELECT
                            CONCAT(ACC.NUMSERIE, ' - ', ACC.NUMALBARAN) DOCUMENTO,
                            ACC.FECHAALBARAN FECHA,
                            ACC.TOTALBRUTO,
                            ACC.TOTALNETO,
                            CONCAT(AVC.NUMSERIE, ' - ', AVC.NUMALBARAN) DOCUMENTOVENTA,
                            RF.NOMBRECOMERCIAL,
                            ALM.POBLACION,
                            '${dbName}' MARCA
                        FROM ${DBO}.ALBCOMPRACAB ACC
                        INNER JOIN ${DBO}.ALBVENTACAB AVC ON ACC.SUALBARAN = CONCAT('.', AVC.NUMSERIE, '-', AVC.NUMALBARAN)
                        INNER JOIN ${DBO}.ALBVENTACAMPOSLIBRES AVCL
                            ON AVCL.NUMALBARAN = AVC.NUMALBARAN AND AVCL.NUMSERIE = AVC.NUMSERIE AND AVCL.N = AVC.N
                        LEFT JOIN ${DBO}.REM_CAJASFRONT RCF ON RCF.CAJAMANAGER COLLATE Modern_Spanish_CI_AS = SUBSTRING(ACC.NUMSERIE, 1, 3)
                        LEFT JOIN ${DBO}.REM_FRONTS RF ON RF.IDFRONT = RCF.IDFRONT
                        LEFT JOIN ${DBO}.ALMACEN ALM ON ALM.CODALMACEN = RCF.CODALMCOMPRAS COLLATE Modern_Spanish_CI_AS
                        WHERE AVCL.CONTENEDOR LIKE @contenedor AND ACC.NUMSERIE LIKE 'T%'
                    `);
                return result.recordset;
            } catch { return []; }
        }))).flat();
        res.json(resultados);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

const updateContenedorEnMarca = async (contenedor: string, pathBD: string): Promise<number> => {
    try {
        const bPool = await getBrandPool(pathBD);
        const dbName = parsearDbName(pathBD);
        const DBO = `${dbName}.DBO`;
        const result = await bPool.request()
            .input('contenedor', sql.NVarChar, contenedor)
            .query(`
                UPDATE ${DBO}.ALBCOMPRACAMPOSLIBRES
                SET CONTENEDOR = @contenedor
                WHERE CONCAT(NUMSERIE, ' - ', NUMALBARAN) IN (
                    SELECT CONCAT(ACC.NUMSERIE, ' - ', ACC.NUMALBARAN)
                    FROM ${DBO}.ALBCOMPRACAB ACC
                    INNER JOIN ${DBO}.ALBVENTACAB AVC ON ACC.SUALBARAN = CONCAT('.', AVC.NUMSERIE, '-', AVC.NUMALBARAN)
                    INNER JOIN ${DBO}.ALBVENTACAMPOSLIBRES AVCL
                        ON AVCL.NUMALBARAN = AVC.NUMALBARAN AND AVCL.NUMSERIE = AVC.NUMSERIE
                    WHERE AVCL.CONTENEDOR LIKE @contenedor AND ACC.NUMSERIE LIKE 'T%' AND AVC.NORECIBIDO = 'F'
                )
            `);
        return result.rowsAffected[0];
    } catch (error: any) {
        console.error(`Error updateContenedor en ${pathBD}:`, error.message);
        return 0;
    }
};

// ─────────────────────────────────────────────
// MAESTRO DE GASTOS
// ─────────────────────────────────────────────

app.post('/api/sincronizar-maestro-gastos', authenticate, async (req: Request, res: Response) => {
    try {
        const dbNames = getDbNamesFromReq(req);
        const pool = await poolPromise;
        let total = 0;

        for (const dbName of dbNames) {
            try {
                const bPool = await getBrandPool(dbName);
                const DBO = `${dbName}.DBO`;
                const resultERP = await bPool.request().query(`
                    SELECT ART.REFPROVEEDOR AS CODIGO_ERP, ART.DESCRIPCION AS NOMBRE_GASTO
                    FROM ${DBO}.ARTICULOS ART
                    WHERE ART.REFPROVEEDOR LIKE 'C%'
                `);

                for (const gasto of resultERP.recordset) {
                    await pool.request()
                        .input('cod', sql.NVarChar, gasto.CODIGO_ERP)
                        .input('nom', sql.NVarChar, gasto.NOMBRE_GASTO)
                        .input('marca', sql.NVarChar, dbName)
                        .query(`
                            IF EXISTS (SELECT 1 FROM MAESTRO_GASTOS WHERE CODIGO_ERP = @cod AND MARCA = @marca)
                                UPDATE MAESTRO_GASTOS SET NOMBRE_GASTO = @nom WHERE CODIGO_ERP = @cod AND MARCA = @marca
                            ELSE
                                INSERT INTO MAESTRO_GASTOS (CODIGO_ERP, NOMBRE_GASTO, MARCA, ACTIVO)
                                VALUES (@cod, @nom, @marca, 1)
                        `);
                    total++;
                }
            } catch { /* BD no disponible */ }
        }

        res.json({ message: `Sincronizados ${total} gastos de ${dbNames.length} marcas.` });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/maestro-gastos/:marca', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const marca = req.params.marca;

        // Si marca es 'ALL', traer los de todas las marcas del usuario
        const dbNames = getDbNamesFromReq(req);
        let query: string;
        let request = pool.request();

        if (marca === 'ALL') {
            query = `SELECT * FROM MAESTRO_GASTOS WHERE ACTIVO = 1 ORDER BY MARCA, NOMBRE_GASTO`;
        } else {
            request = request.input('marca', sql.NVarChar, marca);
            query = `SELECT * FROM MAESTRO_GASTOS WHERE MARCA = @marca AND ACTIVO = 1`;
        }

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// PROCESAR GASTOS EN TIENDAS (multi-marca)
// ─────────────────────────────────────────────

/** Resuelve nombres de BD planos a su pathBD completo usando servers.json */
function resolverPathBDsDesdeNombres(dbNames: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const db of dbNames) {
        const host = resolverServidor(db);
        map.set(db.toUpperCase(), host ? `${host}:${db}` : db);
    }
    return map;
}

/** Lógica central de cierre — reutilizada tanto por el cierre individual como por el masivo */
async function ejecutarCierreContenedor(cidInt: number): Promise<{ mensaje: string; detalle: Record<string, any> }> {
        const pool = await poolPromise;

        const contResult = await pool.request()
            .input('cid', sql.Int, cidInt)
            .query('SELECT NUMEROCONTENEDOR FROM CONTENEDORES WHERE CONTENEDORID = @cid');
        if (contResult.recordset.length === 0) throw new Error('Contenedor no encontrado');
        const numeroContenedor: string = contResult.recordset[0].NUMEROCONTENEDOR;

        const marcasResult = await pool.request()
            .input('cid', sql.Int, cidInt)
            .query('SELECT DISTINCT DB_NAME FROM CONTENEDOR_MARCAS WHERE CONTENEDORID = @cid');
        const plainDbNames: string[] = marcasResult.recordset.map((r: any) => r.DB_NAME);
        const pathBDMap = resolverPathBDsDesdeNombres(plainDbNames);
        const dbNames: string[] = plainDbNames;

        const gastosLocales = (await pool.request()
            .input('cid', sql.Int, cidInt)
            .query('SELECT * FROM GASTOSCONTENEDOR WHERE CONTENEDORID = @cid')).recordset;

        const maestroResult = await pool.request()
            .query(`SELECT TOP 1 CODIGO_ERP FROM MAESTRO_GASTOS WHERE NOMBRE_GASTO LIKE '%COSTO_REAL%' AND ACTIVO = 1`);
        const COD_COSTO_REAL = maestroResult.recordset[0]?.CODIGO_ERP ?? null;

        console.log(`[CIERRE] Contenedor=${numeroContenedor} | Marcas=${dbNames.join(',')} | Gastos=${gastosLocales.length} | COSTO_REAL=${COD_COSTO_REAL}`);

        // Pre-calcular total del contenedor: suma de TOTALNETO de albaranes Z de todas las marcas
        let totalGlobalChina = 0;
        for (const dbName of dbNames) {
            try {
                const pathBD = pathBDMap.get(dbName.toUpperCase()) || dbName;
                const bPool = await getBrandPool(pathBD);
                const r = await bPool.request()
                    .input('cont', sql.NVarChar, numeroContenedor)
                    .query(`
                        SELECT ISNULL(SUM(ACC.TOTALNETO), 0) AS TOTAL
                        FROM ALBCOMPRACAB ACC
                        INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL
                            ON ACCL.NUMALBARAN = ACC.NUMALBARAN AND ACCL.NUMSERIE = ACC.NUMSERIE AND ACCL.N = ACC.N
                        WHERE ACC.NUMSERIE LIKE 'Z%' AND ACCL.CONTENEDOR = @cont
                    `);
                totalGlobalChina += Number(r.recordset[0]?.TOTAL || 0);
            } catch { /* BD no disponible */ }
        }
        console.log(`[CIERRE] TotalContenedor=${totalGlobalChina}`);

        const detalleLog: Record<string, any> = {};

        for (const dbName of dbNames) {
            const DBO = `${dbName}.DBO`;
            const log: any = { albaranesTienda: 0, albZ: null, gastosAplicar: 0, lineasInsertadas: 0, error: null };
            detalleLog[dbName] = log;

            try {
                const pathBD = pathBDMap.get(dbName.toUpperCase()) || dbName;
                const bPool = await getBrandPool(pathBD);

                await updateContenedorEnMarca(numeroContenedor, pathBD);

                const albaranesTienda = (await bPool.request()
                    .input('cont', sql.NVarChar, numeroContenedor)
                    .query(`
                        SELECT ACC.NUMSERIE, ACC.NUMALBARAN
                        FROM ALBCOMPRACAB ACC
                        INNER JOIN ALBVENTACAB AVC ON ACC.SUALBARAN = CONCAT('.', AVC.NUMSERIE, '-', AVC.NUMALBARAN)
                        INNER JOIN ALBVENTACAMPOSLIBRES AVCL
                            ON AVCL.NUMALBARAN = AVC.NUMALBARAN AND AVCL.NUMSERIE = AVC.NUMSERIE
                        WHERE AVCL.CONTENEDOR = @cont AND ACC.NUMSERIE LIKE 'T%'
                    `)).recordset;

                log.albaranesTienda = albaranesTienda.length;
                console.log(`[CIERRE][${dbName}] AlbaranesTienda=${albaranesTienda.length}`);
                if (albaranesTienda.length === 0) continue;

                const compraZResult = (await bPool.request()
                    .input('cont', sql.NVarChar, numeroContenedor)
                    .query(`
                        SELECT TOP 1 ACC.NUMSERIE, ACC.NUMALBARAN
                        FROM ALBCOMPRACAB ACC
                        INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL
                            ON ACCL.NUMALBARAN = ACC.NUMALBARAN AND ACCL.NUMSERIE = ACC.NUMSERIE AND ACCL.N = ACC.N
                        WHERE ACCL.CONTENEDOR = @cont AND ACC.NUMSERIE LIKE 'Z%'
                    `)).recordset;

                log.albZ = compraZResult.length > 0 ? `${compraZResult[0].NUMSERIE}-${compraZResult[0].NUMALBARAN}` : 'NO ENCONTRADO';
                console.log(`[CIERRE][${dbName}] AlbaranZ=${log.albZ}`);

                // ── Batch resolve REFPROVEEDOR → CODARTICULO (evita N+1) ──────────────
                const gastosAplicar = gastosLocales.filter((g: any) => !g.DB_NAME || g.DB_NAME === dbName);
                log.gastosAplicar = gastosAplicar.length;
                console.log(`[CIERRE][${dbName}] GastosAplicar=${gastosAplicar.length}`);

                const todosRefs = [...new Set([
                    ...(COD_COSTO_REAL ? [String(COD_COSTO_REAL)] : []),
                    ...gastosAplicar.map((g: any) => String(g.CODIGO_ERP))
                ].filter(Boolean))];
                const articuloMap = new Map<string, number>();
                if (todosRefs.length > 0) {
                    const batchReq = bPool.request();
                    todosRefs.forEach((ref, i) => batchReq.input(`r${i}`, sql.NVarChar, ref));
                    const inList = todosRefs.map((_, i) => `@r${i}`).join(', ');
                    const batchResult = await batchReq.query(
                        `SELECT REFPROVEEDOR, MIN(CODARTICULO) AS CODARTICULO FROM ARTICULOS WHERE REFPROVEEDOR IN (${inList}) GROUP BY REFPROVEEDOR`
                    );
                    batchResult.recordset.forEach((row: any) => articuloMap.set(String(row.REFPROVEEDOR), row.CODARTICULO));
                }
                const codArt = (ref: string): number | null => articuloMap.get(ref) ?? null;

                // ── 1. COSTO_REAL ────────────────────────────────────────────────────
                if (COD_COSTO_REAL && compraZResult.length > 0) {
                    const codArticuloCostoReal = codArt(String(COD_COSTO_REAL));
                    if (codArticuloCostoReal != null) {
                        const albZ = compraZResult[0];
                        for (const albT of albaranesTienda) {
                            const lineasT = (await bPool.request()
                                .input('serT', sql.VarChar, albT.NUMSERIE)
                                .input('numT', sql.Int, albT.NUMALBARAN)
                                .query(`SELECT NUMLIN, CODARTICULO FROM ALBCOMPRALIN WHERE NUMSERIE = @serT AND NUMALBARAN = @numT`)).recordset;

                            for (const linT of lineasT) {
                                if (linT.CODARTICULO == null) continue;
                                const precioZ = (await bPool.request()
                                    .input('serZ', sql.VarChar, albZ.NUMSERIE)
                                    .input('numZ', sql.Int, albZ.NUMALBARAN)
                                    .input('art', sql.Int, linT.CODARTICULO)
                                    .query(`SELECT TOP 1 PRECIO FROM ALBCOMPRALIN WHERE NUMSERIE = @serZ AND NUMALBARAN = @numZ AND CODARTICULO = @art`)).recordset;

                                if (precioZ.length > 0) {
                                    await bPool.request()
                                        .input('serT', sql.VarChar, albT.NUMSERIE)
                                        .input('numT', sql.Int, albT.NUMALBARAN)
                                        .input('linT', sql.Int, linT.NUMLIN)
                                        .input('imp', sql.Float, precioZ[0].PRECIO)
                                        .input('codG', sql.Int, codArticuloCostoReal)
                                        .query(`
                                            IF NOT EXISTS (SELECT 1 FROM ALBCOMPRAGASTOS WHERE NUMSERIE = @serT AND NUMALBARAN = @numT AND NUMLIN = @linT AND CODARTICULO = @codG)
                                            INSERT INTO ALBCOMPRAGASTOS (NUMSERIE, NUMALBARAN, N, NUMLIN, IDGASTO, IMPORTE, CODMONEDA, ORDENGASTO, CODARTICULO, ENFACTURA, NUMLINDOC, SOBRELINEASPOSITIVAS)
                                            VALUES (@serT, @numT, 'B', @linT, 1, @imp, 2, 0, @codG, 0, -1, 'T')
                                        `);
                                    log.lineasInsertadas++;
                                }
                            }
                        }
                    }
                }

                // ── 2. GASTOS DE LOGÍSTICA ────────────────────────────────────────────
                for (const alb of albaranesTienda) {
                    for (const gasto of gastosAplicar) {
                        const codArticuloGasto = codArt(String(gasto.CODIGO_ERP));
                        if (codArticuloGasto == null) {
                            console.log(`[CIERRE][${dbName}] REFPROVEEDOR ${gasto.CODIGO_ERP} no encontrado en ARTICULOS, se omite.`);
                            continue;
                        }

                        const lineas = (await bPool.request()
                            .input('ser', sql.VarChar, alb.NUMSERIE)
                            .input('num', sql.Int, alb.NUMALBARAN)
                            .input('contenedor', sql.NVarChar, numeroContenedor)
                            .input('totalGlobal', sql.Float, totalGlobalChina)
                            .query(`;WITH CTE_COMPRAS_PRECIOS_CHINA AS (
                                SELECT ACCL2.CONTENEDOR, ACL2.CODARTICULO, MAX(ACL2.PRECIO) AS PRECIO_CHINA
                                FROM ALBCOMPRALIN ACL2
                                INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL2
                                    ON ACCL2.NUMALBARAN = ACL2.NUMALBARAN AND ACCL2.NUMSERIE = ACL2.NUMSERIE AND ACCL2.N = ACL2.N
                                WHERE ACL2.NUMSERIE LIKE 'Z%' AND ACCL2.CONTENEDOR = @contenedor
                                GROUP BY ACCL2.CONTENEDOR, ACL2.CODARTICULO
                            ),
                            CTE_LINEAS_ALBARAN_TIENDA AS (
                                SELECT ACL.NUMLIN, ACL.CODARTICULO,
                                    ACL.UNIDADESTOTAL * ISNULL(CP.PRECIO_CHINA, 0) AS COSTE_LINEA_CHINA
                                FROM ALBCOMPRALIN ACL
                                LEFT JOIN CTE_COMPRAS_PRECIOS_CHINA CP ON CP.CODARTICULO = ACL.CODARTICULO
                                WHERE ACL.NUMSERIE = @ser AND ACL.NUMALBARAN = @num
                            ),
                            CTE_TOTAL_ALBARAN_TIENDA AS (
                                SELECT SUM(COSTE_LINEA_CHINA) AS TOTAL_ALBARAN_COSTE_CHINA FROM CTE_LINEAS_ALBARAN_TIENDA
                            )
                            SELECT L.NUMLIN,
                                CASE WHEN T.TOTAL_ALBARAN_COSTE_CHINA = 0 THEN 0
                                     ELSE ROUND((L.COSTE_LINEA_CHINA * 100.0) / T.TOTAL_ALBARAN_COSTE_CHINA, 4)
                                END AS PORCENTAJE_REPARTO_INTERNO,
                                CASE WHEN @totalGlobal = 0 THEN 0
                                     ELSE ROUND((T.TOTAL_ALBARAN_COSTE_CHINA * 100.0) / @totalGlobal, 2)
                                END AS PORCENTAJE_ALBARAN_SOBRE_CONTENEDOR
                            FROM CTE_LINEAS_ALBARAN_TIENDA L
                            CROSS JOIN CTE_TOTAL_ALBARAN_TIENDA T
                        `)).recordset;

                        console.log(`[CIERRE][${dbName}] Alb=${alb.NUMSERIE}-${alb.NUMALBARAN} Gasto=${gasto.CODIGO_ERP} Lineas=${lineas.length}`);

                        for (const linea of lineas) {
                            const importeGasto = (gasto.IMPORTE * (linea.PORCENTAJE_ALBARAN_SOBRE_CONTENEDOR / 100)) * (linea.PORCENTAJE_REPARTO_INTERNO / 100);
                            await bPool.request()
                                .input('ser', sql.VarChar, alb.NUMSERIE)
                                .input('num', sql.Int, alb.NUMALBARAN)
                                .input('lin', sql.Int, linea.NUMLIN)
                                .input('imp', sql.Float, importeGasto)
                                .input('cod', sql.Int, codArticuloGasto)
                                .query(`
                                    IF NOT EXISTS (SELECT 1 FROM ALBCOMPRAGASTOS WHERE NUMSERIE = @ser AND NUMALBARAN = @num AND NUMLIN = @lin AND CODARTICULO = @cod)
                                    INSERT INTO ALBCOMPRAGASTOS (NUMSERIE, NUMALBARAN, N, NUMLIN, IDGASTO, IMPORTE, CODMONEDA, ORDENGASTO, CODARTICULO, ENFACTURA, NUMLINDOC, SOBRELINEASPOSITIVAS)
                                    VALUES (@ser, @num, 'B', @lin, (SELECT ISNULL(MAX(IDGASTO), 0) + 1 FROM ALBCOMPRAGASTOS WHERE NUMSERIE = @ser AND NUMALBARAN = @num AND NUMLIN = @lin), @imp, 2, 1, @cod, 0, -1, 'T')
                                `);
                            log.lineasInsertadas++;
                        }
                    }
                }

                console.log(`[CIERRE][${dbName}] TOTAL lineas insertadas=${log.lineasInsertadas}`);
            } catch (err: any) {
                log.error = err.message;
                console.error(`[CIERRE][${dbName}] ERROR:`, err.message);
            }
        }

        await pool.request()
            .input('cid', sql.Int, cidInt)
            .query("UPDATE CONTENEDORES SET ESTATUS = 'PROCESADO' WHERE CONTENEDORID = @cid");

        console.log(`[CIERRE] Finalizado. Detalle:`, JSON.stringify(detalleLog));
        return { mensaje: `Cierre completado para: ${dbNames.join(', ')}.`, detalle: detalleLog };
}

// Cierre individual
app.post('/api/contenedores/:id/procesar-gastos-tiendas', authenticate, async (req: Request, res: Response) => {
    try {
        const cidInt = parseInt(req.params.id as string);
        const result = await ejecutarCierreContenedor(cidInt);
        res.json({ message: result.mensaje, detalle: result.detalle });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Cierre masivo — procesa todos los contenedores pendientes
app.post('/api/contenedores/cierre-masivo', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const pendientes = await pool.request()
            .query(`SELECT CONTENEDORID, NUMEROCONTENEDOR FROM CONTENEDORES WHERE ESTATUS != 'PROCESADO' ORDER BY CREATEDAT`);

        const resultados: Record<string, any> = {};
        let exitosos = 0, fallidos = 0;

        for (const c of pendientes.recordset) {
            try {
                const r = await ejecutarCierreContenedor(c.CONTENEDORID);
                resultados[c.NUMEROCONTENEDOR] = { ok: true, detalle: r.detalle };
                exitosos++;
            } catch (e: any) {
                resultados[c.NUMEROCONTENEDOR] = { ok: false, error: e.message };
                fallidos++;
            }
        }

        res.json({
            total: pendientes.recordset.length,
            exitosos,
            fallidos,
            resultados
        });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// REPORTES
// ─────────────────────────────────────────────

app.get('/api/reportes/costos-tienda', authenticate, async (req: Request, res: Response) => {
    try {
        const contenedor = String(req.query.contenedor || '');
        const serie      = String(req.query.serie || 'T%');
        const numero     = parseInt(String(req.query.numero || '0')) || 0;
        const marcaFiltro = req.query.marca ? String(req.query.marca).toUpperCase() : null;

        if (!contenedor) return res.status(400).json({ error: 'El parámetro contenedor es requerido' });

        const dbNames = marcaFiltro ? [marcaFiltro] : getDbNamesFromReq(req);
        const resultadosTotales: any[] = [];
        const errores: Record<string, string> = {};

        const REPORTE_SQL = `
            ;WITH CTE_COMPRAS_PRECIOS_CHINA AS (
                SELECT
                    ACCL2.CONTENEDOR,
                    ACL2.CODARTICULO,
                    MAX(ACL2.PRECIO) AS PRECIO_CHINA
                FROM ALBCOMPRALIN ACL2
                INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL2
                    ON ACCL2.NUMALBARAN = ACL2.NUMALBARAN
                    AND ACCL2.NUMSERIE  = ACL2.NUMSERIE
                    AND ACCL2.N         = ACL2.N
                WHERE ACL2.NUMSERIE LIKE 'Z%'
                AND ACCL2.CONTENEDOR LIKE @CONTENEDOR
                AND ISNULL(ACCL2.CONTENEDOR, '') <> ''
                GROUP BY ACCL2.CONTENEDOR, ACL2.CODARTICULO
            ),
            CTE_TOTAL_CONTENEDOR_IMPORT AS (
                SELECT SUM(ACL.UNIDADESTOTAL * ISNULL(CP.PRECIO_CHINA, 0)) AS TOTAL_GLOBAL_CHINA
                FROM ALBCOMPRALIN ACL
                INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL
                    ON ACCL.NUMALBARAN = ACL.NUMALBARAN
                    AND ACCL.NUMSERIE  = ACL.NUMSERIE
                    AND ACCL.N         = ACL.N
                LEFT JOIN CTE_COMPRAS_PRECIOS_CHINA CP ON CP.CODARTICULO = ACL.CODARTICULO
                WHERE ACL.NUMSERIE LIKE 'Z%'
                AND ISNULL(ACCL.CONTENEDOR, '') <> ''
                AND ACCL.CONTENEDOR LIKE @CONTENEDOR
            ),
            CTE_LINEAS_ALBARAN_TIENDA AS (
                SELECT
                    ACL.NUMLIN,
                    ACL.CODARTICULO,
                    ACL.TALLA,
                    ACL.COLOR,
                    ACL.UNIDADESTOTAL,
                    ACCL.CONTENEDOR,
                    CP.PRECIO_CHINA,
                    CASE WHEN ACG.IDGASTO = 1 THEN ACG.IMPORTE ELSE 0 END AS GASTO1,
                    CASE WHEN ACG.IDGASTO = 2 THEN ACG.IMPORTE ELSE 0 END AS GASTO2,
                    CASE WHEN ACG.IDGASTO = 3 THEN ACG.IMPORTE ELSE 0 END AS GASTO3,
                    ACL.UNIDADESTOTAL * ISNULL(CP.PRECIO_CHINA, 0) AS COSTE_LINEA_CHINA
                FROM ALBCOMPRALIN ACL
                INNER JOIN ALBCOMPRACAMPOSLIBRES ACCL
                    ON ACCL.NUMALBARAN = ACL.NUMALBARAN
                    AND ACCL.NUMSERIE  = ACL.NUMSERIE
                    AND ACCL.N         = ACL.N
                LEFT JOIN ALBCOMPRAGASTOS ACG
                    ON ACG.NUMSERIE   = ACL.NUMSERIE
                    AND ACG.NUMALBARAN = ACL.NUMALBARAN
                    AND ACG.N          = ACL.N
                    AND ACG.NUMLIN     = ACL.NUMLIN
                LEFT JOIN CTE_COMPRAS_PRECIOS_CHINA CP
                    ON CP.CODARTICULO = ACL.CODARTICULO
                    AND CP.CONTENEDOR = ACCL.CONTENEDOR
                WHERE ACL.NUMSERIE LIKE @SER
                AND ISNULL(ACCL.CONTENEDOR, '') <> ''
                AND (ACL.NUMALBARAN = @NUM OR @NUM = 0)
            )
            SELECT DISTINCT
                L.CODARTICULO,
                ART.DESCRIPCION  AS NOMBRE_ARTICULO,
                ART.REFPROVEEDOR AS REFERENCIA,
                MAX(ARL.ULTIMOCOSTE) AS ULTIMO_COSTE,
                MAX(L.GASTO1)    AS GASTO1,
                MAX(L.GASTO2)    AS GASTO2,
                MAX(L.GASTO3)    AS GASTO3,
                MAX(L.GASTO1) + MAX(L.GASTO2) + MAX(L.GASTO3) AS GASTOS_TOTAL,
                MAX(L.PRECIO_CHINA) AS PRECIO_CHINA,
                SUM(L.COSTE_LINEA_CHINA) AS PRECIO_TOTAL,
                SUM(L.UNIDADESTOTAL) AS UNIDADES,
                L.CONTENEDOR
            FROM CTE_LINEAS_ALBARAN_TIENDA L
            INNER JOIN ARTICULOSLIN ARL
                ON ARL.CODARTICULO = L.CODARTICULO
                AND ARL.COLOR = L.COLOR
                AND ARL.TALLA = L.TALLA
            INNER JOIN ARTICULOS ART ON ART.CODARTICULO = L.CODARTICULO
            GROUP BY L.CODARTICULO, ART.DESCRIPCION, ART.REFPROVEEDOR, L.CONTENEDOR
            ORDER BY L.CODARTICULO ASC
        `;

        for (const dbName of dbNames) {
            try {
                const bPool = await getBrandPool(dbName);
                const result = await bPool.request()
                    .input('CONTENEDOR', sql.NVarChar, contenedor)
                    .input('SER',        sql.NVarChar, serie)
                    .input('NUM',        sql.Int,      numero)
                    .query(REPORTE_SQL);

                result.recordset.forEach((row: any) => {
                    resultadosTotales.push({ ...row, MARCA: dbName });
                });
            } catch (err: any) {
                errores[dbName] = err.message;
                console.error(`[REPORTE][${dbName}]`, err.message);
            }
        }

        // Ordenar: primero por MARCA, luego por CODARTICULO
        resultadosTotales.sort((a, b) =>
            a.MARCA.localeCompare(b.MARCA) || String(a.CODARTICULO).localeCompare(String(b.CODARTICULO))
        );

        res.json({
            data: resultadosTotales,
            ...(Object.keys(errores).length > 0 && { errores })
        });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// TASAS DE CAMBIO
// ─────────────────────────────────────────────

// GET /api/tasas — Devuelve tasa BCV (via función ERP) y tasa Binance (de TASAS_CAMBIO)
app.get('/api/tasas', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const dbNames = getDbNamesFromReq(req);

        // Tasa BCV: cross-DB desde GENERAL usando la primera marca del usuario
        let bcv: number | null = null;
        const gPool = await generalPoolPromise;
        for (const dbName of dbNames) {
            try {
                const r = await gPool.request()
                    .query(`SELECT ${dbName}.DBO.F_GET_COTIZACION(CONVERT(DATE, GETDATE()), 4) AS TASA`);
                const val = Number(r.recordset[0]?.TASA);
                if (!isNaN(val) && val > 0) { bcv = val; break; }
            } catch { /* intentar siguiente marca */ }
        }

        // Tasa Binance: desde TASAS_CAMBIO
        const binanceRes = await pool.request()
            .query(`SELECT TASA FROM TASAS_CAMBIO WHERE TIPO = 'BINANCE'`);
        const binance: number | null = binanceRes.recordset.length > 0
            ? Number(binanceRes.recordset[0].TASA)
            : null;

        res.json({ bcv, binance });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// POST /api/tasas/binance — Guarda o actualiza la tasa Binance
app.post('/api/tasas/binance', authenticate, async (req: Request, res: Response) => {
    try {
        const { tasa } = req.body;
        if (tasa === undefined || tasa === null || isNaN(Number(tasa))) {
            return res.status(400).json({ error: 'Se requiere el campo tasa (número)' });
        }
        const pool = await poolPromise;
        await pool.request()
            .input('tasa', sql.Decimal(18, 4), Number(tasa))
            .query(`
                IF EXISTS (SELECT 1 FROM TASAS_CAMBIO WHERE TIPO = 'BINANCE')
                    UPDATE TASAS_CAMBIO SET TASA = @tasa, FECHA = GETDATE() WHERE TIPO = 'BINANCE'
                ELSE
                    INSERT INTO TASAS_CAMBIO (TIPO, TASA) VALUES ('BINANCE', @tasa)
            `);
        res.json({ ok: true, tasa: Number(tasa) });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// ADMIN: Endpoints de administración
// ─────────────────────────────────────────────

// Listar usuarios para el panel admin
app.get('/api/admin/usuarios', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const gPool = await generalPoolPromise;
        const pool  = await poolPromise;
        const [usersRes, adminsRes, permisosRes] = await Promise.all([
            gPool.request().query(`SELECT CODUSUARIO, USUARIO FROM USUARIOS WHERE ISNULL(DESCATALOGADO,'F')='F' ORDER BY USUARIO`),
            pool.request().query('SELECT USUARIO FROM USUARIOS_ADMIN'),
            pool.request().query('SELECT USUARIO, PERMISO FROM PERMISOS_USUARIO')
        ]);
        const adminSet = new Set(adminsRes.recordset.map((r: any) => r.USUARIO));
        const permMap: Record<string, string[]> = {};
        permisosRes.recordset.forEach((r: any) => {
            if (!permMap[r.USUARIO]) permMap[r.USUARIO] = [];
            permMap[r.USUARIO].push(r.PERMISO);
        });
        const usuarios = usersRes.recordset.map((u: any) => ({
            CODUSUARIO: u.CODUSUARIO,
            USUARIO: u.USUARIO,
            isAdmin: adminSet.has(u.USUARIO),
            permisos: permMap[u.USUARIO] || []
        }));
        res.json(usuarios);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Toggle admin de un usuario
app.put('/api/admin/usuarios/:usuario/admin', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { usuario } = req.params;
        const { isAdmin } = req.body;
        const pool = await poolPromise;
        if (isAdmin) {
            await pool.request().input('usr', sql.NVarChar, usuario)
                .query('IF NOT EXISTS (SELECT 1 FROM USUARIOS_ADMIN WHERE USUARIO=@usr) INSERT INTO USUARIOS_ADMIN VALUES (@usr)');
        } else {
            await pool.request().input('usr', sql.NVarChar, usuario)
                .query('DELETE FROM USUARIOS_ADMIN WHERE USUARIO = @usr');
        }
        res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Actualizar permisos de un usuario
app.put('/api/admin/usuarios/:usuario/permisos', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { usuario } = req.params;
        const { permisos }: { permisos: string[] } = req.body;
        const pool = await poolPromise;
        await pool.request().input('usr', sql.NVarChar, usuario)
            .query('DELETE FROM PERMISOS_USUARIO WHERE USUARIO = @usr');
        for (const p of permisos) {
            await pool.request().input('usr', sql.NVarChar, usuario).input('p', sql.NVarChar, p)
                .query('INSERT INTO PERMISOS_USUARIO (USUARIO, PERMISO) VALUES (@usr, @p)');
        }
        res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Gestión de MAESTRO_GASTOS desde el admin
app.get('/api/admin/maestro-gastos', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const { pkCol, tipoTasa } = await getMaestroMeta();
        const result = await pool.request().query(`
            SELECT ${pkCol} AS ID, CODIGO_ERP, NOMBRE_GASTO, MARCA, ACTIVO,
                   ${tipoTasa ? "ISNULL(TIPO_TASA,'BCV')" : "'BCV'"} AS TIPO_TASA
            FROM MAESTRO_GASTOS
            ORDER BY MARCA, NOMBRE_GASTO
        `);
        res.json(result.recordset);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/maestro-gastos', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { CODIGO_ERP, NOMBRE_GASTO, MARCA, ACTIVO, TIPO_TASA } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('cod', sql.NVarChar, CODIGO_ERP)
            .input('nom', sql.NVarChar, NOMBRE_GASTO)
            .input('marca', sql.NVarChar, MARCA || null)
            .input('activo', sql.Bit, ACTIVO !== false ? 1 : 0)
            .input('tipoTasa', sql.NVarChar, TIPO_TASA || 'BCV')
            .query('INSERT INTO MAESTRO_GASTOS (CODIGO_ERP, NOMBRE_GASTO, MARCA, ACTIVO, TIPO_TASA) VALUES (@cod, @nom, @marca, @activo, @tipoTasa)');
        res.status(201).json({ ok: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.put('/api/admin/maestro-gastos/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { NOMBRE_GASTO, ACTIVO, TIPO_TASA } = req.body;
        const pool = await poolPromise;
        const { pkCol, tipoTasa: tieneTipoTasa } = await getMaestroMeta();
        const q = pool.request()
            .input('id', sql.Int, req.params.id)
            .input('nom', sql.NVarChar, NOMBRE_GASTO)
            .input('activo', sql.Bit, ACTIVO ? 1 : 0);
        if (tieneTipoTasa) {
            q.input('tipoTasa', sql.NVarChar, TIPO_TASA || 'BCV');
            await q.query(`UPDATE MAESTRO_GASTOS SET NOMBRE_GASTO=@nom, ACTIVO=@activo, TIPO_TASA=@tipoTasa WHERE ${pkCol}=@id`);
        } else {
            await q.query(`UPDATE MAESTRO_GASTOS SET NOMBRE_GASTO=@nom, ACTIVO=@activo WHERE ${pkCol}=@id`);
        }
        res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/admin/maestro-gastos/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;
        const { pkCol } = await getMaestroMeta();
        await pool.request().input('id', sql.Int, req.params.id)
            .query(`DELETE FROM MAESTRO_GASTOS WHERE ${pkCol} = @id`);
        res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// BORRADO COMPLETO DE CONTENEDOR (solo admin)
// ─────────────────────────────────────────────

app.delete('/api/contenedores/:id/completo', authenticate, requireAdmin, async (req: Request, res: Response) => {
    try {
        const pool      = await poolPromise;
        const cidInt    = parseInt(req.params.id as string);

        const contRes = await pool.request().input('cid', sql.Int, cidInt)
            .query('SELECT NUMEROCONTENEDOR FROM CONTENEDORES WHERE CONTENEDORID = @cid');
        if (contRes.recordset.length === 0) return res.status(404).json({ error: 'Contenedor no encontrado' });
        const numeroContenedor: string = contRes.recordset[0].NUMEROCONTENEDOR;

        const marcasRes = await pool.request().input('cid', sql.Int, cidInt)
            .query('SELECT DISTINCT DB_NAME FROM CONTENEDOR_MARCAS WHERE CONTENEDORID = @cid');
        const dbNames: string[] = marcasRes.recordset.map((r: any) => r.DB_NAME);
        const pathBDMap = resolverPathBDsDesdeNombres(dbNames);

        const errores: Record<string, string> = {};

        // Para cada marca: borrar ALBCOMPRAGASTOS de sus albaranes T
        for (const dbName of dbNames) {
            try {
                const pathBD = pathBDMap.get(dbName.toUpperCase()) || dbName;
                const bPool = await getBrandPool(pathBD);

                const albaranesT = (await bPool.request()
                    .input('cont', sql.NVarChar, numeroContenedor)
                    .query(`
                        SELECT ACC.NUMSERIE, ACC.NUMALBARAN
                        FROM ALBCOMPRACAB ACC
                        INNER JOIN ALBVENTACAB AVC ON ACC.SUALBARAN = CONCAT('.', AVC.NUMSERIE, '-', AVC.NUMALBARAN)
                        INNER JOIN ALBVENTACAMPOSLIBRES AVCL ON AVCL.NUMALBARAN=AVC.NUMALBARAN AND AVCL.NUMSERIE=AVC.NUMSERIE
                        WHERE AVCL.CONTENEDOR = @cont AND ACC.NUMSERIE LIKE 'T%'
                    `)).recordset;

                for (const alb of albaranesT) {
                    await bPool.request()
                        .input('ser', sql.VarChar, alb.NUMSERIE)
                        .input('num', sql.Int, alb.NUMALBARAN)
                        .query('DELETE FROM ALBCOMPRAGASTOS WHERE NUMSERIE=@ser AND NUMALBARAN=@num');
                }
            } catch (err: any) {
                errores[dbName] = err.message;
                console.error(`[DELETE][${dbName}]`, err.message);
            }
        }

        // Borrar en GESTIONCOMPRASDB
        await pool.request().input('cid', sql.Int, cidInt).query('DELETE FROM GASTOSCONTENEDOR WHERE CONTENEDORID=@cid');
        await pool.request().input('cid', sql.Int, cidInt).query('DELETE FROM CONTENEDOR_MARCAS WHERE CONTENEDORID=@cid');
        await pool.request().input('cid', sql.Int, cidInt).query('DELETE FROM CONTENEDORES WHERE CONTENEDORID=@cid');

        res.json({ ok: true, ...(Object.keys(errores).length && { advertencias: errores }) });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// CARGA MASIVA DE GASTOS VÍA EXCEL
// ─────────────────────────────────────────────

// Descargar plantilla Excel de gastos
app.get('/api/contenedores/:id/gastos/plantilla', authenticate, async (req: Request, res: Response) => {
    try {
        const pool  = await poolPromise;
        const cidInt = parseInt(req.params.id as string);
        // Cargamos los gastos del maestro para sugerirlos
        const maestro = (await pool.request().query('SELECT CODIGO_ERP, NOMBRE_GASTO, MARCA FROM MAESTRO_GASTOS WHERE ACTIVO=1 ORDER BY MARCA, NOMBRE_GASTO')).recordset;

        const wb = XLSX.utils.book_new();

        // Hoja 1: Plantilla para rellenar
        const plantillaData = [
            ['NOMBREGASTO', 'CODIGO_ERP', 'IMPORTE', 'FACTOR', 'MARCA'],
            ...maestro.map((g: any) => [g.NOMBRE_GASTO, g.CODIGO_ERP, '', '0', g.MARCA || ''])
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(plantillaData);
        ws1['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'GASTOS');

        // Hoja 2: Referencia de gastos disponibles
        const refData = [['CODIGO_ERP', 'NOMBRE_GASTO', 'MARCA'], ...maestro.map((g: any) => [g.CODIGO_ERP, g.NOMBRE_GASTO, g.MARCA || ''])];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(refData), 'REFERENCIA');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', `attachment; filename="plantilla_gastos_contenedor_${cidInt}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Subir Excel de gastos y procesarlo
app.post('/api/contenedores/:id/gastos/bulk', authenticate, upload.single('archivo'), async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
        const cidInt = parseInt(req.params.id as string);
        const pool   = await poolPromise;

        // Verificar que el contenedor no esté procesado
        const contRes = await pool.request().input('cid', sql.Int, cidInt)
            .query(`SELECT ESTATUS FROM CONTENEDORES WHERE CONTENEDORID = @cid`);
        if (contRes.recordset[0]?.ESTATUS === 'PROCESADO')
            return res.status(400).json({ error: 'No se pueden agregar gastos a un contenedor ya procesado' });

        const wb    = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });

        let insertados = 0;
        const errores: string[] = [];

        for (const row of rows) {
            const nombre    = String(row['NOMBREGASTO'] || '').trim();
            const codigoERP = row['CODIGO_ERP'];
            const importe   = parseFloat(String(row['IMPORTE'] || '0').replace(',', '.'));
            const factor    = parseFloat(String(row['FACTOR'] || '0').replace(',', '.'));
            const marca     = String(row['MARCA'] || '').trim() || null;

            if (!nombre || !importe) { errores.push(`Fila sin NOMBREGASTO o IMPORTE: ${JSON.stringify(row)}`); continue; }

            // Buscar MAESTRO_GASTO_ID
            const maestroRes = await pool.request()
                .input('cod', sql.NVarChar, String(codigoERP))
                .input('marca', sql.NVarChar, marca)
                .query('SELECT TOP 1 ID FROM MAESTRO_GASTOS WHERE CODIGO_ERP = @cod AND (MARCA = @marca OR @marca IS NULL)');

            const maestroId = maestroRes.recordset[0]?.ID ?? null;

            await pool.request()
                .input('cid',   sql.Int,          cidInt)
                .input('nom',   sql.NVarChar,      nombre)
                .input('imp',   sql.Decimal(18,4), importe)
                .input('fac',   sql.Decimal(10,6), isNaN(factor) ? 0 : factor)
                .input('mid',   sql.Int,           maestroId)
                .input('erp',   sql.NVarChar,      codigoERP != null ? String(codigoERP) : null)
                .input('marca', sql.NVarChar,      marca)
                .input('db',    sql.NVarChar,      marca)
                .query(`INSERT INTO GASTOSCONTENEDOR (CONTENEDORID,NOMBREGASTO,IMPORTE,FACTOR,MAESTRO_GASTO_ID,CODIGO_ERP,MARCA,DB_NAME)
                        VALUES (@cid,@nom,@imp,@fac,@mid,@erp,@marca,@db)`);
            insertados++;
        }

        res.json({ insertados, ...(errores.length && { errores }) });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// CARGA MASIVA DE GASTOS (multi-contenedor)
// ─────────────────────────────────────────────

// Convierte un valor de celda Excel a 'YYYY-MM-DD'. Acepta strings ISO y seriales numéricos de Excel.
function excelFechaToISO(val: any): string | null {
    if (!val && val !== 0) return null;
    if (val instanceof Date) return val.toISOString().split('T')[0];
    const s = String(val).trim();
    if (!s) return null;
    const n = Number(s);
    if (!isNaN(n) && n > 10000 && n < 200000) {
        // Serial de Excel: días desde 1900-01-00 (con bug del año bisiesto de Lotus)
        const d = new Date(Math.round((n - 25569) * 86400 * 1000));
        return d.toISOString().split('T')[0];
    }
    return s; // ya es string tipo "YYYY-MM-DD"
}

// GET /api/gastos/plantilla-masiva  →  descarga Excel con columnas: CONTENEDOR + dos por cada gasto activo (importe + tasa/fecha)
app.get('/api/gastos/plantilla-masiva', authenticate, async (req: Request, res: Response) => {
    try {
        const pool = await poolPromise;

        const { pkCol, tipoTasa: tieneTipoTasa } = await getMaestroMeta();
        const maestro = await pool.request()
            .query(`SELECT ${pkCol} AS ID, NOMBRE_GASTO, CODIGO_ERP,
                           ${tieneTipoTasa ? "ISNULL(TIPO_TASA,'BCV')" : "'BCV'"} AS TIPO_TASA
                    FROM MAESTRO_GASTOS WHERE ACTIVO = 1 ORDER BY ${pkCol}`);
        const gastos = maestro.recordset;

        // Por cada gasto generamos dos columnas:
        //   1. El importe:   "NOMBRE [ID:X]"
        //   2. Extra según tipo:
        //        BINANCE → "TASA_BINANCE [TASA:X]"
        //        BCV     → "FECHA_PAGO [FECHA:X]"
        const headers: string[] = ['CONTENEDOR'];
        const colWidths: any[]   = [{ wch: 22 }];
        for (const g of gastos) {
            headers.push(`${g.NOMBRE_GASTO} [ID:${g.ID}]`);
            colWidths.push({ wch: 22 });
            if (g.TIPO_TASA === 'BINANCE') {
                headers.push(`TASA_BINANCE [TASA:${g.ID}]`);
            } else {
                headers.push(`FECHA_PAGO [FECHA:${g.ID}]`);
            }
            colWidths.push({ wch: 20 });
        }

        // Fila ejemplo orientativa
        const ejemplo: string[] = ['MEDU123456-7'];
        for (const g of gastos) {
            ejemplo.push('');  // importe
            ejemplo.push(g.TIPO_TASA === 'BINANCE' ? '38.50' : '2025-01-15'); // placeholder
        }

        const ws = XLSX.utils.aoa_to_sheet([headers, ejemplo]);
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Carga Masiva');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="plantilla_carga_masiva_gastos.xlsx"');
        res.send(buffer);
    } catch (error: any) {
        console.error('[plantilla-masiva] ERROR:', error.message, '\n', error.stack);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

// POST /api/gastos/bulk-masiva  →  procesa Excel y crea gastos en todos los contenedores
app.post('/api/gastos/bulk-masiva', authenticate, upload.single('archivo'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    try {
        const pool = await poolPromise;

        // Leer Excel
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return res.status(400).json({ error: 'El archivo no tiene datos.' });

        const headers: string[] = (rows[0] as any[]).map(String);

        // Parsear columnas de importe:  [ID:X]
        const gastosCols: Array<{ colIdx: number; gastoId: number }> = [];
        for (let i = 1; i < headers.length; i++) {
            const m = headers[i].match(/\[ID:(\d+)\]/);
            if (m) gastosCols.push({ colIdx: i, gastoId: parseInt(m[1]) });
        }
        if (gastosCols.length === 0) return res.status(400).json({ error: 'No se encontraron columnas de gastos válidas. Usa la plantilla original.' });

        // Columnas auxiliares: [TASA:X] para Binance, [FECHA:X] para BCV
        const tasaCols  = new Map<number, number>(); // gastoId → colIdx
        const fechaCols = new Map<number, number>(); // gastoId → colIdx
        for (let i = 1; i < headers.length; i++) {
            const mt = headers[i].match(/\[TASA:(\d+)\]/);
            if (mt) tasaCols.set(parseInt(mt[1]), i);
            const mf = headers[i].match(/\[FECHA:(\d+)\]/);
            if (mf) fechaCols.set(parseInt(mf[1]), i);
        }

        const { pkCol: mPkCol, tipoTasa: mTieneTipo } = await getMaestroMeta();
        const maestroRes = await pool.request()
            .query(`SELECT ${mPkCol} AS ID, NOMBRE_GASTO, CODIGO_ERP,
                           ${mTieneTipo ? "ISNULL(TIPO_TASA,'BCV')" : "'BCV'"} AS TIPO_TASA
                    FROM MAESTRO_GASTOS`);
        const maestroMap = new Map<number, any>(maestroRes.recordset.map((g: any) => [g.ID, g]));

        let insertados = 0;
        const errores: string[] = [];

        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            const contenedorNum = String(row[0] || '').trim();
            if (!contenedorNum || contenedorNum.toLowerCase() === 'medu123456-7') continue; // salta fila ejemplo

            // Buscar el contenedor
            const cRes = await pool.request()
                .input('num', sql.NVarChar, contenedorNum)
                .query(`SELECT CONTENEDORID, VALOR_USS FROM CONTENEDORES WHERE NUMEROCONTENEDOR = @num`);

            if (cRes.recordset.length === 0) {
                errores.push(`Fila ${r + 1}: contenedor "${contenedorNum}" no encontrado.`);
                continue;
            }

            const { CONTENEDORID, VALOR_USS } = cRes.recordset[0];

            for (const col of gastosCols) {
                const raw = row[col.colIdx];
                if (raw === '' || raw === null || raw === undefined) continue;
                const importe = parseFloat(String(raw));
                if (isNaN(importe) || importe <= 0) continue;

                const maestro = maestroMap.get(col.gastoId);
                if (!maestro) continue;

                const factor = VALOR_USS > 0 ? importe / Number(VALOR_USS) : 0;

                // Leer tasa o fecha según el tipo de cambio del gasto
                let tasaCambio: number | null = null;
                let fechaPago: string | null = null;
                if (maestro.TIPO_TASA === 'BINANCE') {
                    const tasaRaw = tasaCols.has(col.gastoId) ? row[tasaCols.get(col.gastoId)!] : '';
                    const tasaVal = parseFloat(String(tasaRaw || ''));
                    if (!isNaN(tasaVal) && tasaVal > 0) tasaCambio = tasaVal;
                } else {
                    const fechaRaw = fechaCols.has(col.gastoId) ? row[fechaCols.get(col.gastoId)!] : null;
                    fechaPago = excelFechaToISO(fechaRaw);
                }

                await pool.request()
                    .input('cid',   sql.Int,           CONTENEDORID)
                    .input('nom',   sql.NVarChar,      maestro.NOMBRE_GASTO)
                    .input('imp',   sql.Decimal(18, 4), importe)
                    .input('fac',   sql.Decimal(10, 6), factor)
                    .input('mid',   sql.Int,            col.gastoId)
                    .input('erp',   sql.NVarChar,       String(maestro.CODIGO_ERP))
                    .input('tasa',  sql.Decimal(18, 4), tasaCambio)
                    .input('fecha', sql.NVarChar,       fechaPago)
                    .query(`INSERT INTO GASTOSCONTENEDOR (CONTENEDORID,NOMBREGASTO,IMPORTE,FACTOR,MAESTRO_GASTO_ID,CODIGO_ERP,TASA_CAMBIO,FECHA_PAGO)
                            VALUES (@cid,@nom,@imp,@fac,@mid,@erp,@tasa,@fecha)`);
                insertados++;
            }
        }

        res.json({ success: true, insertados, errores });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// SETUP DE TABLAS ADMIN (se ejecuta al iniciar)
// ─────────────────────────────────────────────

async function setupAdminTables() {
    try {
        const pool = await poolPromise;
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='USUARIOS_ADMIN' AND xtype='U')
            CREATE TABLE USUARIOS_ADMIN (USUARIO NVARCHAR(50) PRIMARY KEY);
        `);
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='PERMISOS_USUARIO' AND xtype='U')
            CREATE TABLE PERMISOS_USUARIO (
                ID INT IDENTITY PRIMARY KEY,
                USUARIO NVARCHAR(50) NOT NULL,
                PERMISO NVARCHAR(50) NOT NULL,
                CONSTRAINT UQ_USUARIO_PERMISO UNIQUE(USUARIO, PERMISO)
            );
        `);
        // Seed admin inicial
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM USUARIOS_ADMIN WHERE USUARIO='REDESIP')
            INSERT INTO USUARIOS_ADMIN VALUES ('REDESIP');
        `);
        console.log('✅ Tablas de admin verificadas/creadas');
    } catch (err: any) {
        console.error('⚠ Error creando tablas admin:', err.message);
    }
}

setupAdminTables();

// ─────────────────────────────────────────────
// CONFIGURACIÓN DE CONEXIÓN (admin)
// ─────────────────────────────────────────────

function leerEnv(): Record<string, string> {
    const envPath = path.join(process.env.PROJECT_ROOT || path.join(__dirname, '..'), '.env');
    const map: Record<string, string> = {};
    if (!fs.existsSync(envPath)) return map;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return map;
}

function escribirEnv(updates: Record<string, string>): void {
    const envPath = path.join(process.env.PROJECT_ROOT || path.join(__dirname, '..'), '.env');
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    for (const [key, value] of Object.entries(updates)) {
        const re = new RegExp(`^${key}=.*$`, 'm');
        re.test(content) ? (content = content.replace(re, `${key}=${value}`)) : (content += `\n${key}=${value}`);
    }
    fs.writeFileSync(envPath, content, 'utf8');
}

app.get('/api/admin/config', authenticate, requireAdmin, (_req: Request, res: Response) => {
    const env = leerEnv();
    res.json({
        server:          env.SERVER           || process.env.SERVER           || '',
        user:            env.SA_USER          || process.env.SA_USER          || '',
        hasPassword:     !!(env.SA_PASSWORD   || process.env.SA_PASSWORD),
        marcasExcluidas: env.MARCAS_EXCLUIDAS || process.env.MARCAS_EXCLUIDAS || '',
    });
});

app.put('/api/admin/config', authenticate, requireAdmin, (req: Request, res: Response) => {
    const { server, user, password, marcasExcluidas } = req.body || {};
    const updates: Record<string, string> = {};
    if (server          !== undefined) updates.SERVER           = server;
    if (user            !== undefined) updates.SA_USER          = user;
    if (password        !== undefined && password !== '') { updates.SA_PASSWORD = password; updates.PASSWORD = password; }
    if (marcasExcluidas !== undefined) updates.MARCAS_EXCLUIDAS = marcasExcluidas;
    escribirEnv(updates);
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 400);
});

// Servidores adicionales (servers.json)
const _serversPath = () => path.join(process.env.PROJECT_ROOT || path.join(__dirname, '..'), 'servers.json');

app.get('/api/admin/servers', authenticate, requireAdmin, (_req: Request, res: Response) => {
    let list: any[] = [];
    if (fs.existsSync(_serversPath())) {
        try { list = JSON.parse(fs.readFileSync(_serversPath(), 'utf8')); } catch {}
    }
    res.json(list.map(s => ({ host: s.host, port: s.port || '', instance: s.instance || '', user: s.user, hasPassword: !!s.password, databases: s.databases || '' })));
});

app.put('/api/admin/servers', authenticate, requireAdmin, (req: Request, res: Response) => {
    // Recibe array completo; passwords vacíos conservan el valor anterior
    const incoming: Array<{ host: string; user: string; password?: string }> = req.body || [];

    // Leer passwords actuales para conservarlos si vienen vacíos
    let existing: any[] = [];
    if (fs.existsSync(_serversPath())) {
        try { existing = JSON.parse(fs.readFileSync(_serversPath(), 'utf8')); } catch {}
    }
    const existingMap = new Map(existing.map((s: any) => [s.host.trim().toLowerCase(), s.password]));

    const list = incoming.map((s: any) => ({
        host:      s.host.trim(),
        ...(s.port     ? { port: Number(s.port) } : {}),
        ...(s.instance?.trim() ? { instance: s.instance.trim() } : {}),
        user:      s.user.trim(),
        password:  s.password?.trim() || existingMap.get(s.host.trim().toLowerCase()) || '',
        databases: s.databases || '',
    }));

    fs.writeFileSync(_serversPath(), JSON.stringify(list, null, 2), 'utf8');
    res.json({ ok: true }); // no reinicia — lo hace updateConfig en el mismo flujo
});

// HEALTH CHECK (sin auth — para polling del updater)
// ─────────────────────────────────────────────

app.get('/api/health', (req: Request, res: Response) => {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        res.json({ ok: true, version: pkg.version || '1.0.0' });
    } catch { res.json({ ok: true, version: 'unknown' }); }
});

// ─────────────────────────────────────────────
// AUTO-UPDATER (descarga ZIP de GitHub y reinicia)
// ─────────────────────────────────────────────

function descargarArchivo(url: string, destino: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const seguir = (urlActual: string, profundidad = 0) => {
            if (profundidad > 5) return reject(new Error('Demasiadas redirecciones'));
            const lib = urlActual.startsWith('https://') ? https : http;
            lib.get(urlActual, { headers: { 'User-Agent': 'CostoVenezuela-Updater/1.0' } }, (res) => {
                if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                    return seguir(res.headers.location, profundidad + 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const file = fs.createWriteStream(destino);
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve()));
                file.on('error', (err) => { try { fs.unlinkSync(destino); } catch {} reject(err); });
                res.on('error', (err) => { try { fs.unlinkSync(destino); } catch {} reject(err); });
            }).on('error', reject);
        };
        seguir(url);
    });
}

function runPs1(script: string): void {
    const tmp = path.join(os.tmpdir(), `cv_upd_${Date.now()}.ps1`);
    fs.writeFileSync(tmp, `$ErrorActionPreference = 'Stop'\n${script}`, 'utf8');
    try {
        execSync(`powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, { stdio: 'pipe', timeout: 300000 });
    } finally { try { fs.unlinkSync(tmp); } catch {} }
}

let _actualizando = false;

app.post('/api/admin/actualizar', authenticate, requireAdmin, (req: Request, res: Response) => {
    if (_actualizando) return res.status(409).json({ error: 'Ya hay una actualización en curso.' });
    const zipUrl: string = req.body?.zip_url;
    if (!zipUrl) return res.status(400).json({ error: 'Se requiere zip_url.' });
    _actualizando = true;
    res.json({ ok: true, mensaje: 'Actualización iniciada. El servidor se reiniciará al completar.' });
    setImmediate(async () => {
        const tempDir = path.join(os.tmpdir(), `cv_upd_${Date.now()}`);
        try {
            const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), '..');
            const zipPath = path.join(tempDir, 'update.zip');
            const extractPath = path.join(tempDir, 'extracted');
            fs.mkdirSync(tempDir, { recursive: true });

            console.log('[UPDATE] Descargando:', zipUrl);
            await descargarArchivo(zipUrl, zipPath);

            console.log('[UPDATE] Extrayendo...');
            fs.mkdirSync(extractPath, { recursive: true });
            runPs1(`Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force`);

            const entries = fs.readdirSync(extractPath);
            const srcRoot = entries.length === 1 && fs.statSync(path.join(extractPath, entries[0])).isDirectory()
                ? path.join(extractPath, entries[0]) : extractPath;

            console.log('[UPDATE] Copiando archivos...');
            const copyLines = [
                `Copy-Item -Path '${srcRoot}\\backend\\src' -Destination '${projectRoot}\\backend' -Recurse -Force`,
                `Copy-Item -Path '${srcRoot}\\backend\\package.json' -Destination '${projectRoot}\\backend\\package.json' -Force`,
                `Copy-Item -Path '${srcRoot}\\backend\\tsconfig.json' -Destination '${projectRoot}\\backend\\tsconfig.json' -Force`,
                `Copy-Item -Path '${srcRoot}\\frontend\\src' -Destination '${projectRoot}\\frontend' -Recurse -Force`,
                ...['package.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
                    .map(f => `if (Test-Path '${srcRoot}\\frontend\\${f}') { Copy-Item '${srcRoot}\\frontend\\${f}' '${projectRoot}\\frontend\\${f}' -Force }`)
            ];
            runPs1(copyLines.join('\n'));

            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
            console.log('[UPDATE] Completo. Reiniciando...');
            setTimeout(() => process.exit(0), 500);
        } catch (err: any) {
            console.error('[UPDATE] ERROR:', err.message);
            _actualizando = false;
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        }
    });
});

// Servir frontend compilado (producción)
const distPath = path.join(process.env.PROJECT_ROOT || path.join(__dirname, '..', '..'), 'frontend', 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // Catch-all para Vue Router (history mode)
    app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(distPath, 'index.html')));
    console.log('📦 Sirviendo frontend desde:', distPath);
}

app.listen(3001, () => console.log('🚀 Backend corriendo en puerto 3001'));
