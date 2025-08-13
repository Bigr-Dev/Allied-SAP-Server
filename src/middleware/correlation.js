import { v4 as uuidv4 } from 'uuid'

export function correlationId() {
  return (req, _res, next) => {
    req.headers['x-correlation-id'] =
      req.headers['x-correlation-id'] || uuidv4()
    next()
  }
}
