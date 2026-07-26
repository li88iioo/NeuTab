import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { AUTH_CODE, JWT_SECRET } from '../middleware/auth.js'

const router: ExpressRouter = Router()

const readCookie = (req: Request, name: string): string | undefined => {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

router.post('/login', (req: Request, res: Response) => {
  const { authCode } = req.body

  if (!AUTH_CODE) {
    return res.status(500).json({ error: 'AUTH_CODE not configured on server', code: 'AUTH_CODE_NOT_CONFIGURED' })
  }

  const a = Buffer.from(String(authCode || ''))
  const b = Buffer.from(AUTH_CODE)
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!valid) {
    return res.status(401).json({ error: 'Invalid auth code', code: 'INVALID_AUTH_CODE' })
  }

  const token = jwt.sign(
    { authorized: true, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.cookie('neutab_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  })

  // token 仍在响应体中返回,供非浏览器客户端(扩展)以 Bearer 方式使用;
  // 网页客户端应依赖 httpOnly cookie,不要将其落入 localStorage。
  res.json({ token })
})

// 供网页客户端探测 cookie 会话是否有效(token 是 httpOnly,前端读不到)
router.get('/session', (req: Request, res: Response) => {
  const token = readCookie(req, 'neutab_token')
  if (!token) return res.json({ authenticated: false })
  try {
    jwt.verify(token, JWT_SECRET)
    return res.json({ authenticated: true })
  } catch {
    return res.json({ authenticated: false })
  }
})

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('neutab_token', { path: '/' })
  res.json({ success: true })
})

export default router
