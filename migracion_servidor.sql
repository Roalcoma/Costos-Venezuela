-- ============================================================
--  SCRIPT DE MIGRACIÓN — COSTO VENEZUELA
--  Base de datos destino: GESTIONCOMPRASDB
--  Ejecutar conectado a GESTIONCOMPRASDB en el servidor
--  Todas las sentencias son idempotentes (IF NOT EXISTS)
--  Última actualización: 2026-05-28
--  Cambios v2: TASAS_CAMBIO, TIPO_TASA, TASA_CAMBIO, FECHA_PAGO
-- ============================================================

USE GESTIONCOMPRASDB;
GO

-- ============================================================
-- 1. TABLA: CONTENEDORES
--    Registro maestro de cada importación gestionada
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'CONTENEDORES' AND xtype = 'U')
BEGIN
    CREATE TABLE CONTENEDORES (
        CONTENEDORID      INT            IDENTITY(1,1) PRIMARY KEY,
        NUMEROCONTENEDOR  NVARCHAR(100)  NOT NULL,
        BILLOFLADING      NVARCHAR(100)  NULL,
        BUQUE_VIAJE       NVARCHAR(200)  NULL,
        ESTATUS           NVARCHAR(50)   NOT NULL DEFAULT 'TRANSITO',
        TAMANO            NVARCHAR(20)   NULL,
        IMPORTADOR        NVARCHAR(200)  NULL,
        PROCEDENCIA       NVARCHAR(200)  NULL,
        NUMEROFACTURA     NVARCHAR(100)  NULL,
        VALOR_USS         DECIMAL(18,2)  NOT NULL DEFAULT 0,
        BULTOS            INT            NULL DEFAULT 0,
        FECHASALIDA_ETD   DATE           NULL,
        FECHALLEGADA_ETA  DATE           NULL,
        OBSERVACIONES     NVARCHAR(MAX)  NULL,
        CREATEDAT         DATETIME       NOT NULL DEFAULT GETDATE()
    );
    PRINT '✅ Tabla CONTENEDORES creada.';
END
ELSE
    PRINT '⏭  Tabla CONTENEDORES ya existe.';
GO

-- ============================================================
-- 2. TABLA: CONTENEDOR_MARCAS
--    Relación N:M entre contenedores y bases de datos de marca
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'CONTENEDOR_MARCAS' AND xtype = 'U')
BEGIN
    CREATE TABLE CONTENEDOR_MARCAS (
        ID            INT           IDENTITY(1,1) PRIMARY KEY,
        CONTENEDORID  INT           NOT NULL,
        MARCA         NVARCHAR(100) NOT NULL,
        DB_NAME       NVARCHAR(100) NOT NULL,
        CONSTRAINT FK_CM_CONTENEDOR FOREIGN KEY (CONTENEDORID)
            REFERENCES CONTENEDORES (CONTENEDORID)
    );
    CREATE INDEX IX_CM_CONTENEDORID ON CONTENEDOR_MARCAS (CONTENEDORID);
    PRINT '✅ Tabla CONTENEDOR_MARCAS creada.';
END
ELSE
    PRINT '⏭  Tabla CONTENEDOR_MARCAS ya existe.';
GO

-- ============================================================
-- 3. TABLA: MAESTRO_GASTOS
--    Catálogo de conceptos de gasto logístico (admin CRUD)
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'MAESTRO_GASTOS' AND xtype = 'U')
BEGIN
    CREATE TABLE MAESTRO_GASTOS (
        ID           INT            IDENTITY(1,1) PRIMARY KEY,
        CODIGO_ERP   NVARCHAR(50)   NOT NULL,
        NOMBRE_GASTO NVARCHAR(200)  NOT NULL,
        MARCA        NVARCHAR(100)  NULL,
        ACTIVO       BIT            NOT NULL DEFAULT 1
    );
    CREATE INDEX IX_MG_MARCA   ON MAESTRO_GASTOS (MARCA);
    CREATE INDEX IX_MG_ACTIVO  ON MAESTRO_GASTOS (ACTIVO);
    PRINT '✅ Tabla MAESTRO_GASTOS creada.';
END
ELSE
    PRINT '⏭  Tabla MAESTRO_GASTOS ya existe.';
GO

-- ============================================================
-- 4. TABLA: GASTOSCONTENEDOR
--    Gastos individuales asignados a cada contenedor
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'GASTOSCONTENEDOR' AND xtype = 'U')
BEGIN
    CREATE TABLE GASTOSCONTENEDOR (
        GASTOID          INT            IDENTITY(1,1) PRIMARY KEY,
        CONTENEDORID     INT            NOT NULL,
        NOMBREGASTO      NVARCHAR(200)  NOT NULL,
        IMPORTE          DECIMAL(18,4)  NOT NULL DEFAULT 0,
        FACTOR           DECIMAL(10,6)  NOT NULL DEFAULT 0,
        MAESTRO_GASTO_ID INT            NULL,
        CODIGO_ERP       NVARCHAR(50)   NULL,
        MARCA            NVARCHAR(100)  NULL,
        DB_NAME          NVARCHAR(100)  NULL,
        DESCRIPCIONGASTO NVARCHAR(500)  NULL,
        TASA_CAMBIO      DECIMAL(18,4)  NULL,   -- cotización Binance al momento del pago
        FECHA_PAGO       DATE           NULL,   -- fecha de pago para gastos BCV
        CONSTRAINT FK_GC_CONTENEDOR FOREIGN KEY (CONTENEDORID)
            REFERENCES CONTENEDORES (CONTENEDORID)
    );
    CREATE INDEX IX_GC_CONTENEDORID ON GASTOSCONTENEDOR (CONTENEDORID);
    PRINT '✅ Tabla GASTOSCONTENEDOR creada.';
END
ELSE
BEGIN
    PRINT '⏭  Tabla GASTOSCONTENEDOR ya existe.';
    -- Agregar columnas nuevas si la tabla ya existía (idempotente)
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('GASTOSCONTENEDOR') AND name = 'TASA_CAMBIO')
    BEGIN
        ALTER TABLE GASTOSCONTENEDOR ADD TASA_CAMBIO DECIMAL(18,4) NULL;
        PRINT '  ✅ Columna TASA_CAMBIO agregada a GASTOSCONTENEDOR.';
    END
    ELSE
        PRINT '  ⏭  Columna TASA_CAMBIO ya existe.';

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('GASTOSCONTENEDOR') AND name = 'FECHA_PAGO')
    BEGIN
        ALTER TABLE GASTOSCONTENEDOR ADD FECHA_PAGO DATE NULL;
        PRINT '  ✅ Columna FECHA_PAGO agregada a GASTOSCONTENEDOR.';
    END
    ELSE
        PRINT '  ⏭  Columna FECHA_PAGO ya existe.';
END
GO

-- ============================================================
-- 5. TABLA: TASAS_CAMBIO
--    Almacena la tasa de cambio Binance (actualizable desde el admin)
--    La tasa BCV se consulta directamente del ERP vía F_GET_COTIZACION
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'TASAS_CAMBIO' AND xtype = 'U')
BEGIN
    CREATE TABLE TASAS_CAMBIO (
        ID    INT           IDENTITY(1,1) PRIMARY KEY,
        TIPO  NVARCHAR(20)  NOT NULL UNIQUE,   -- 'BINANCE' | 'BCV'
        TASA  DECIMAL(18,4) NOT NULL,
        FECHA DATETIME      NOT NULL DEFAULT GETDATE()
    );
    -- Insertar fila inicial para Binance (la tasa se actualiza desde el panel admin)
    INSERT INTO TASAS_CAMBIO (TIPO, TASA) VALUES ('BINANCE', 0);
    PRINT '✅ Tabla TASAS_CAMBIO creada con fila inicial BINANCE.';
END
ELSE
    PRINT '⏭  Tabla TASAS_CAMBIO ya existe.';
GO

-- ============================================================
-- 6. COLUMNA: MAESTRO_GASTOS.TIPO_TASA
--    Indica con qué tasa se convierte el gasto: BCV u BINANCE
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MAESTRO_GASTOS') AND name = 'TIPO_TASA')
BEGIN
    ALTER TABLE MAESTRO_GASTOS ADD TIPO_TASA NVARCHAR(20) NOT NULL DEFAULT 'BCV';
    PRINT '✅ Columna TIPO_TASA agregada a MAESTRO_GASTOS (default BCV).';
END
ELSE
    PRINT '⏭  Columna TIPO_TASA ya existe en MAESTRO_GASTOS.';
GO

-- ============================================================
-- 8. TABLA: USUARIOS_ADMIN
--    Lista de usuarios con rol administrador en la app
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'USUARIOS_ADMIN' AND xtype = 'U')
BEGIN
    CREATE TABLE USUARIOS_ADMIN (
        USUARIO NVARCHAR(50) NOT NULL PRIMARY KEY
    );
    PRINT '✅ Tabla USUARIOS_ADMIN creada.';
END
ELSE
    PRINT '⏭  Tabla USUARIOS_ADMIN ya existe.';
GO

-- ============================================================
-- 9. TABLA: PERMISOS_USUARIO
--    Permisos granulares por usuario (GESTION, REPORTES)
--    Si un usuario no tiene filas → acceso completo por defecto
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'PERMISOS_USUARIO' AND xtype = 'U')
BEGIN
    CREATE TABLE PERMISOS_USUARIO (
        ID      INT           IDENTITY(1,1) PRIMARY KEY,
        USUARIO NVARCHAR(50)  NOT NULL,
        PERMISO NVARCHAR(50)  NOT NULL,
        CONSTRAINT UQ_USUARIO_PERMISO UNIQUE (USUARIO, PERMISO)
    );
    CREATE INDEX IX_PU_USUARIO ON PERMISOS_USUARIO (USUARIO);
    PRINT '✅ Tabla PERMISOS_USUARIO creada.';
END
ELSE
    PRINT '⏭  Tabla PERMISOS_USUARIO ya existe.';
GO

-- ============================================================
-- 10. DATOS INICIALES — Admin por defecto
--    REDESIP es el único administrador inicial
--    Ajusta el nombre si el usuario en el servidor es diferente
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM USUARIOS_ADMIN WHERE USUARIO = 'REDESIP')
BEGIN
    INSERT INTO USUARIOS_ADMIN (USUARIO) VALUES ('REDESIP');
    PRINT '✅ Usuario REDESIP insertado como admin inicial.';
END
ELSE
    PRINT '⏭  Usuario REDESIP ya estaba registrado como admin.';
GO

-- ============================================================
-- 11. VERIFICACIÓN FINAL — Tablas y columnas clave
-- ============================================================

-- 11a. Resumen de tablas con filas y tamaño
SELECT
    t.name                          AS TABLA,
    SUM(p.rows)                     AS FILAS,
    CAST(
        SUM(a.total_pages) * 8 / 1024.0
    AS DECIMAL(10,2))               AS TAMAÑO_MB
FROM sys.tables t
INNER JOIN sys.indexes i          ON t.object_id = i.object_id
INNER JOIN sys.partitions p       ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.name IN (
    'CONTENEDORES',
    'CONTENEDOR_MARCAS',
    'MAESTRO_GASTOS',
    'GASTOSCONTENEDOR',
    'TASAS_CAMBIO',
    'USUARIOS_ADMIN',
    'PERMISOS_USUARIO'
)
GROUP BY t.name
ORDER BY t.name;
GO

-- 11b. Verificar columnas de tasas/fechas en GASTOSCONTENEDOR
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME   = 'GASTOSCONTENEDOR'
  AND COLUMN_NAME IN ('TASA_CAMBIO', 'FECHA_PAGO')
ORDER BY COLUMN_NAME;
GO

-- 11c. Verificar columna TIPO_TASA en MAESTRO_GASTOS
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME  = 'MAESTRO_GASTOS'
  AND COLUMN_NAME = 'TIPO_TASA';
GO

PRINT '';
PRINT '============================================================';
PRINT ' Migración completada. Verifica:';
PRINT '  • 7 tablas deben aparecer en el resumen de arriba';
PRINT '  • GASTOSCONTENEDOR debe tener TASA_CAMBIO y FECHA_PAGO';
PRINT '  • MAESTRO_GASTOS debe tener TIPO_TASA';
PRINT '============================================================';
