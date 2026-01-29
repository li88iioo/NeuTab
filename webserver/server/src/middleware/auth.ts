/**
 * 共享鉴权中间件
 * 支持 JWT Bearer token 和 X-Auth-Code header
 */
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const AUTH_CODE = process.env.AUTH_CODE

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET
  if (secret) return secret

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production')
  }

  console.warn('[Auth] JWT_SECRET is not set; using an insecure development default secret')
  return 'neutab-default-secret-change-in-production'
})()

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
    try {
      jwt.verify(authHeader.slice(7), JWT_SECRET)
      return next()
    } catch {
      // JWT 无效，继续检查其他方式
    }
  }

  // 方式2：X-Auth-Code header
  const authCode = req.headers['x-auth-code']
  if (AUTH_CODE && authCode === AUTH_CODE) {
    return next()
  }

  res.status(401).json({ error: 'Unauthorized' })
}

/**
 * 可选鉴权中间件（用于需要条件鉴权的端点）
 */
export const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    try {
      jwt.verify(authHeader.slice(7), JWT_SECRET)
      ;(req as any).authenticated = true
    } catch {
      ;(req as any).authenticated = false
    }
  } else {
    const authCode = req.headers['x-auth-code']
    ;(req as any).authenticated = Boolean(AUTH_CODE && authCode === AUTH_CODE)
  }
  next()
}

export { JWT_SECRET, AUTH_CODE }
