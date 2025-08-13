import database from '../config/supabase.js'

export async function apiClientAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    if (!authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: Missing Bearer token' })
    }
    const token = authHeader.slice(7).trim()
    const { data, error } = await database.auth.getUser(token)
    if (error || !data?.user) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: Invalid or expired token' })
    }
    req.user = { ...data.user, sub: data.user.id }
    return next()
  } catch (e) {
    console.error('[apiClientAuth] Service verify failed:', e.message)
    return res
      .status(401)
      .json({ error: 'Unauthorized: Invalid or expired token' })
  }
}
