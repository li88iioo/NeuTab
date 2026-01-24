const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  debug: (...args: any[]) => isDev && console.log('[Debug]', ...args),
  warn: (...args: any[]) => console.warn('[Warn]', ...args),
  error: (...args: any[]) => console.error('[Error]', ...args)
}
