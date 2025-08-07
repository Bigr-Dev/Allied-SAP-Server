import jwt from 'jsonwebtoken'

export const apiClientAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization']

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('Unauthorized: Invalid credentials')
  }

  const token = authHeader.split(' ')[1].trim()

  try {
    const decoded = jwt.verify(token, process.env.JWT_SAP_SECRET.trim())

    req.client = { username: decoded.sub }
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).send('Token expired')
    }
    return res.status(401).send('Invalid token')
  }
}
