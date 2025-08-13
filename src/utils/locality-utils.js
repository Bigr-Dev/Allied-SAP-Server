// utils/locality-utils.js
export function normUp(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim().toUpperCase()
}
export function normTxt(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/**
 * Normalises the incoming locality fields. We DO NOT force a default province here.
 * We first try to ADOPT province/city from an existing route_suburbs entry for the same route.
 */
export function normaliseLocality({
  suburb_name,
  city,
  province,
  postal_code,
}) {
  return {
    suburb_name: normUp(suburb_name || city || 'UNKNOWN'),
    city: normUp(city),
    province: normUp(province),
    postal_code: normTxt(postal_code),
  }
}

/**
 * Find the canonical route_suburbs row for a route + locality, adopting existing values if possible.
 * Resolution order:
 *   1) exact composite
 *   2) same route + postal_code match (most reliable)
 *   3) same route + (suburb_name + city) match
 *   4) same route + suburb_name match (last resort)
 * If incoming province/city are blank, adopt from the found row.
 * If nothing found, upsert a new parent row using the best available (adopted) values.
 */
export async function ensureRouteSuburb(
  database,
  { route_id, suburb_name, city, province, postal_code, position = null }
) {
  // 0) normalise input
  let loc = normaliseLocality({ suburb_name, city, province, postal_code })

  // 1) exact composite
  {
    const { data } = await database
      .from('route_suburbs')
      .select('route_id, suburb_name, city, province, postal_code, position')
      .eq('route_id', route_id)
      .eq('suburb_name', loc.suburb_name)
      .eq('city', loc.city)
      .eq('province', loc.province)
      .eq('postal_code', loc.postal_code)
      .maybeSingle()
    if (data) return data
  }

  // helpers to adopt missing fields
  const adoptFrom = (row) => {
    if (!loc.city) loc.city = row.city
    if (!loc.province) loc.province = row.province
    if (!loc.postal_code) loc.postal_code = row.postal_code
  }

  // 2) by postal_code (if provided)
  if (loc.postal_code) {
    const { data } = await database
      .from('route_suburbs')
      .select('route_id, suburb_name, city, province, postal_code, position')
      .eq('route_id', route_id)
      .eq('postal_code', loc.postal_code)
      .maybeSingle()
    if (data) {
      adoptFrom(data)
      return data
    }
  }

  // 3) by (suburb_name + city)
  if (loc.suburb_name) {
    const { data } = await database
      .from('route_suburbs')
      .select('route_id, suburb_name, city, province, postal_code, position')
      .eq('route_id', route_id)
      .eq('suburb_name', loc.suburb_name)
      .eq('city', loc.city)
      .maybeSingle()
    if (data) {
      adoptFrom(data)
      return data
    }
  }

  // 4) by suburb_name only (last resort)
  {
    const { data } = await database
      .from('route_suburbs')
      .select('route_id, suburb_name, city, province, postal_code, position')
      .eq('route_id', route_id)
      .eq('suburb_name', loc.suburb_name)
      .maybeSingle()
    if (data) {
      adoptFrom(data)
      return data
    }
  }

  // 5) No existing canonical row found → create one (composite PK allows onConflict)
  //    We DO NOT blindly force a province; we insert what we have (could be '')
  const { data: inserted, error: insErr } = await database
    .from('route_suburbs')
    .upsert(
      [
        {
          route_id,
          position: position ?? null,
          suburb_name: loc.suburb_name,
          city: loc.city,
          province: loc.province,
          postal_code: loc.postal_code,
        },
      ],
      {
        onConflict: 'route_id,suburb_name,city,province,postal_code',
        ignoreDuplicates: false,
      }
    )
    .select('route_id, suburb_name, city, province, postal_code, position')
    .maybeSingle()

  if (insErr) throw new Error(`route_suburbs upsert failed: ${insErr.message}`)
  return inserted
}
