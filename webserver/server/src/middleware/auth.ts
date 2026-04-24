/**
 * 共享鉴权中间件
 * 支持 JWT Bearer token 和 X-Auth-Code header
 */
import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

const AUTH_CODE = process.env.AUTH_CODE

if (AUTH_CODE === 'CHANGE_ME_ON_DEPLOY') {
  throw new Error('[Auth] AUTH_CODE must be changed from the default placeholder before starting the server')
}

if (!AUTH_CODE && process.env.NODE_ENV === 'production') {
  throw new Error('[Auth] AUTH_CODE must be set in production')
}

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET
  if (secret) {
    if (secret === 'CHANGE_ME_ON_DEPLOY') {
      throw new Error('[Auth] JWT_SECRET must be changed from the default placeholder before starting the server')
    }
    return secret
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production')
  }

  console.warn('[Auth] JWT_SECRET is not set; using an insecure development default secret')
  return 'neutab-default-secret-change-in-production'
})()

const timingSafeEqualString = (a: string, b: string): boolean => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

const readCookie = (req: Request, name: string): string | undefined => {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

const verifyJwtToken = (token: string | undefined): boolean => {
  if (!token) return false
  try {
    jwt.verify(token, JWT_SECRET)
    return true
  } catch {
    return false
  }
}

const hasValidAuthCode = (req: Request): boolean => {
  const authCode = req.headers['x-auth-code']
  return Boolean(AUTH_CODE && typeof authCode === 'string' && timingSafeEqualString(authCode, AUTH_CODE))
}

/**
 * 验证请求是否已授权
 * 支持两种方式：
 * 1. Authorization: Bearer <jwt>
 * 2. X-Auth-Code: <auth_code>
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 方式1：JWT Bearer
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    if (verifyJwtToken(authHeader.slice(7))) {
      return next()
    }
  }

  if (verifyJwtToken(readCookie(req, 'neutab_token'))) {
    return next()
  }

  // 方式2：X-Auth-Code header
  if (hasValidAuthCode(req)) {
    return next()
  }

  res.status(401).json({ error: 'Unauthorized' })
}

/**
 * 可选鉴权中间件（用于需要条件鉴权的端点）
 */
export const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization
  const bearerOk = authHeader?.startsWith('Bearer ') ? verifyJwtToken(authHeader.slice(7)) : false
  const cookieOk = verifyJwtToken(readCookie(req, 'neutab_token'))
  ;(req as any).authenticated = bearerOk || cookieOk || hasValidAuthCode(req)
  next()
}

export { JWT_SECRET, AUTH_CODE }
