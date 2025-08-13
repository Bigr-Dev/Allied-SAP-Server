// controllers/auth.controller.js

import database from '../config/supabase.js' // your existing query client for SQL (if you still need it)

/**
 * POST /api/login
 * Body:
 *   - email, password
 *     OR (legacy) username, password -> we resolve username -> email from api_clients
 * Returns: { access_token, refresh_token, user }
 */
export const loginWithSupabase = async (req, res) => {
  try {
    let { email, password, username } = req.body ?? {}

    if (!email && username) {
      // OPTIONAL legacy path: resolve username -> email from your table
      const { data: client, error: lookupErr } = await database
        .from('api_clients')
        .select('email')
        .eq('username', username)
        .single()

      if (lookupErr || !client?.email) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }
      email = client.email
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing credentials' })
    }

    const { data, error } = await database.auth.signInWithPassword({
      email,
      password,
    })
    if (error) {
      // Common: Invalid login credentials
      return res.status(401).json({ error: error.message })
    }

    const { session, user } = data
    if (!session?.access_token) {
      return res
        .status(500)
        .json({ error: 'Login failed: no session returned' })
    }

    // Hand back Supabase tokens; your apiClientAuth middleware will verify them on subsequent requests
    return res.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at, // epoch seconds
      token_type: 'bearer',
      user, // includes id, email, app_metadata, user_metadata
    })
  } catch (e) {
    return res
      .status(500)
      .json({ error: 'Unexpected error', details: e.message })
  }
}

/**
 * POST /api/refresh
 * Body: { refresh_token }
 * Returns: { access_token, refresh_token, user }
 */
export const refreshSupabaseSession = async (req, res) => {
  try {
    const { refresh_token } = req.body ?? {}
    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh_token' })
    }

    const { data, error } = await database.auth.refreshSession({
      refresh_token,
    })
    if (error) {
      return res.status(401).json({ error: error.message })
    }

    const { session, user } = data
    if (!session?.access_token) {
      return res
        .status(500)
        .json({ error: 'Refresh failed: no session returned' })
    }

    return res.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      token_type: 'bearer',
      user,
    })
  } catch (e) {
    return res
      .status(500)
      .json({ error: 'Unexpected error', details: e.message })
  }
}

/**
 * POST /api/logout
 * Body (preferred): { refresh_token?: string, global?: boolean }
 * If no refresh_token in body, you can also send it via header: "x-refresh-token".
 */
export const logout = async (req, res) => {
  try {
    const bodyToken = req.body?.refresh_token
    const headerToken = req.headers['x-refresh-token']
    const refresh_token = bodyToken || headerToken

    const global = !!req.body?.global

    if (!refresh_token) {
      // Without a refresh token we can't revoke on the server.
      // Client must drop its local tokens; access tokens expire naturally.
      return res.status(200).json({
        success: true,
        message:
          'No refresh_token provided. Nothing revoked server-side. Please clear tokens client-side.',
      })
    }

    // 1) Hydrate a session from the provided refresh token
    const { data: refreshed, error: refreshErr } =
      await database.auth.refreshSession({ refresh_token })

    if (refreshErr || !refreshed?.session) {
      return res.status(400).json({ error: 'Invalid or expired refresh_token' })
    }

    // 2) Revoke the session (or all sessions if global === true)
    const { error: signOutErr } = await database.auth.signOut({
      scope: global ? 'global' : 'local',
    })
    if (signOutErr) {
      return res.status(500).json({ error: signOutErr.message })
    }

    return res.status(200).json({
      success: true,
      scope: global ? 'global' : 'local',
      message: global
        ? 'Signed out globally. All sessions for this user were revoked.'
        : 'Signed out. This session was revoked.',
    })
  } catch (e) {
    return res
      .status(500)
      .json({ error: 'Unexpected error', details: e.message })
  }
}
