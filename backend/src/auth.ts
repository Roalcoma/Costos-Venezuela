import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ─── Encriptación ICG (mismo algoritmo que el cliente) ────────────────────────
const CONSTANTES = [78,79,82,77,65,76,75,69,89,78,79,82,77,65,76,75,69,89,78,79,82,77,65,76,75,69,89,78,79,82,77,65,76,75,69,89,78];

export function encriptar(texto: string): string {
    let resultado = '';
    for (let i = 0; i < texto.length; i++) {
        const c = CONSTANTES[i % CONSTANTES.length];
        resultado += (texto.charCodeAt(i) + c).toString(16).toUpperCase();
    }
    return resultado;
}

export function desEncriptar(encriptado: string): string {
    let resultado = '';
    let j = 0;
    for (let i = 0; i < encriptado.length; i += 2) {
        const c = CONSTANTES[j % CONSTANTES.length];
        resultado += String.fromCharCode(parseInt(encriptado.substring(i, i + 2), 16) - c);
        j++;
    }
    return resultado;
}
// ──────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES = '8h';

export interface TokenPayload {
    codusuario: number;
    usuario:    string;
    empresas:   Array<{ codempresa: number; titulo: string; dbName: string; pathBD: string }>;
    isAdmin:    boolean;
    permisos:   string[];  // 'REPORTES' | 'GESTION'
}

export function generarToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── Middleware: autenticado ───────────────────────────────────────────────────
export function authenticate(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No autorizado' });
        return;
    }
    const token = header.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
        (req as any).user = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

// ── Middleware: sólo admin ────────────────────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    const user: TokenPayload = (req as any).user;
    if (!user?.isAdmin) {
        res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
        return;
    }
    next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Devuelve los pathBD completos de las marcas del usuario (formato "servidor:NOMBRE_BD" o "NOMBRE_BD").
 * Usar con getBrandPool(pathBD) y parsearDbName(pathBD).
 */
export function getDbNamesFromReq(req: Request): string[] {
    const user: TokenPayload = (req as any).user;
    const excluidas = (process.env.MARCAS_EXCLUIDAS || '')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    return user.empresas
        .filter(e => !excluidas.includes(e.dbName.toUpperCase()))
        .map(e => e.pathBD || e.dbName); // pathBD cuando existe, dbName como fallback (tokens viejos)
}

export function hasPermiso(req: Request, permiso: string): boolean {
    const user: TokenPayload = (req as any).user;
    return user?.isAdmin || (user?.permisos ?? []).includes(permiso);
}
