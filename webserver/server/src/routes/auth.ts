import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { AUTH_CODE, JWT_SECRET } from '../middleware/auth.js'

const router: ExpressRouter = Router()

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

  res.json({ token })
})

export default router
