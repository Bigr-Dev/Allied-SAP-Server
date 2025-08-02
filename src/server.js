import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import ip from 'ip'

import { limiter } from './middleware/rate-limiter.js'
import sapRouter from './routes/sap-routes.js'
import logger from './config/logger.js'

dotenv.config()
const app = express()
const PORT = process.env.PORT || 8800

// Middleware
app.use(cors({ origin: '*' }))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(limiter)

// routes
app.use('/sap', sapRouter)

app.listen(PORT, () => {
  console.log(`Server running on: ${ip.address()}:${PORT}`)
})

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
