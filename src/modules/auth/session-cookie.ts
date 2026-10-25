import type { CookieOptions, Request, Response } from 'express';

/** Cookie httpOnly que guarda el refresh token. Solo se envía a las rutas de auth. */
export const REFRESH_COOKIE = 'zentro_rt';

const cookieOptions = (maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date,
) {
  res.cookie(
    REFRESH_COOKIE,
    token,
    cookieOptions(expiresAt.getTime() - Date.now()),
  );
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}

export function sessionMeta(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}
