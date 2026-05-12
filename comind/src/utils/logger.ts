const isDev = import.meta.env.DEV

export const logger = {
  warn: (message: string, ...args: unknown[]) => {
    if (isDev) console.warn(message, ...args)
  },
  info: (message: string, ...args: unknown[]) => {
    if (isDev) console.info(message, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(message, ...args)
  },
  debug: (message: string, ...args: unknown[]) => {
    if (isDev) console.debug(message, ...args)
  }
}
