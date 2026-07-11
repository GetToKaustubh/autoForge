import pino from 'pino'

const isDev = process.env.NODE_ENV === 'development'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    // Never log these fields — PII & secrets
    paths: [
      'email',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'access_token',
      'refresh_token',
      'authorization',
      'cookie',
      '*.email',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  base: {
    env: process.env.NODE_ENV,
  },
})
