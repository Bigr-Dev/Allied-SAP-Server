import database from '../config/supabase.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

export const auth = async (req, res) => {
  // const { username, password } = req?.body
  const username = req?.body?.username || null
  const password = req?.body?.password || null

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' })
  }

  const { data: user, error } = await database
    .from('api_clients')
    .select('*')
    .eq('username', username)
    .single()

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid user' })
  }

  const isValid = await bcrypt.compare(password, user.password_hash)
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password' })
  }

  const token = jwt.sign({ sub: user.username }, process.env.JWT_SAP_SECRET, {
    expiresIn: '2h',
  })

  return res.json({ token })
}
