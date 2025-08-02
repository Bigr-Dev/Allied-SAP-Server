import winston from 'winston'

// Define the log format
const logFormat = winston.format.printf(
  ({ level, message, timestamp, ...meta }) => {
    return `[${timestamp}] ${level.toUpperCase()}: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta) : ''
    }`
  }
)

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), logFormat),
  defaultMeta: { service: 'allied-sap-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // Optional: Uncomment to log everything to file
    // new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
})

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  )
}

export default logger
