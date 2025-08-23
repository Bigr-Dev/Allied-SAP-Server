// import express from 'express'
// import dotenv from 'dotenv'
// import ip from 'ip'

// import cors from 'cors'
// import { limiter } from './middleware/rate-limiter.js'
// import logger from './config/logger.js'

// import sapRouter from './routes/sap-routes.js'
// import clientRouter from './routes/client-routes.js'
// import { correlationId } from './middleware/correlation.js'

// // initialize environment variables
// dotenv.config()
// const app = express()
// app.use(correlationId())
// const PORT = process.env.PORT || 8800

// // Middleware
// app.use(cors({ origin: '*' }))

// // 🔧 single set of parsers with higher limits
// app.use(express.json({ limit: '25mb' }))
// app.use(express.urlencoded({ limit: '25mb', extended: true }))

// // ✅ lightweight health endpoint (no rate limit)
// app.get('/api/health', (req, res) => {
//   res.status(200).json({
//     ok: true,
//     uptime: process.uptime(),
//     timestamp: new Date().toISOString(),
//   })
// })

// // Apply rate limiter AFTER health
// app.use(limiter)

// // SAP routes
// app.use('/sap', sapRouter)

// // Client routes
// app.use('/api', clientRouter)

// // listeners
// app.listen(PORT, () => {
//   console.log(`Server running on: ${ip.address()}:${PORT}`)
// })

// // error handling
// app.use((err, req, res, next) => {
//   logger.error(err.message, { stack: err.stack })
//   res.status(500).json({ message: 'Internal server error' })
// })
// process.on('uncaughtException', (error) => {
//   logger.error('Uncaught Exception:', error)
//   console.log('Uncaught Exception:', error)
//   process.exit(1)
// })
// process.on('unhandledRejection', (reason, promise) => {
//   logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
//   console.log('Unhandled Rejection at:', promise, 'reason:', reason)
// })
import express from 'express'
import dotenv from 'dotenv'
import ip from 'ip'

import cors from 'cors'
import { limiter } from './middleware/rate-limiter.js'
import logger from './config/logger.js'

import sapRouter from './routes/sap-routes.js'
import clientRouter from './routes/client-routes.js'
import { correlationId } from './middleware/correlation.js'

// initialize environment variables
dotenv.config()
const app = express()
app.use(correlationId())
const PORT = process.env.PORT || 8800

// Middleware
app.use(cors({ origin: '*' }))

// 🔧 single set of parsers with higher limits
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ limit: '25mb', extended: true }))

// ✅ lightweight health endpoint (no rate limit)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

// Apply rate limiter AFTER health
// app.use(limiter)

// SAP routes
app.use('/sap', sapRouter)

// Client routes
app.use('/api', clientRouter)

// listeners
app.listen(PORT, () => {
  console.log(`Server running on: ${ip.address()}:${PORT}`)
})

// error handling
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack })
  res.status(500).json({ message: 'Internal server error' })
})
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  console.log('Uncaught Exception:', error)
  process.exit(1)
})
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
  console.log('Unhandled Rejection at:', promise, 'reason:', reason)
})
