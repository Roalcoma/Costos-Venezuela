/** Decodifica el JWT almacenado en localStorage (sin verificar firma — sólo para UI). */
export function getTokenPayload(): Record<string, any> | null {
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
        const base64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch { return null; }
}

export function isAdmin(): boolean {
    return getTokenPayload()?.isAdmin === true;
}

export function hasPermiso(permiso: string): boolean {
    const p = getTokenPayload();
    return p?.isAdmin === true || (Array.isArray(p?.permisos) && p.permisos.includes(permiso));
}
