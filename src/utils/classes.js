// export class Response {
//   constructor(statusCode, httpStatus, message, data) {
//     this.timeStamp = new Date().toLocaleString()
//     this.statusCode = statusCode
//     this.httpStatus = httpStatus
//     this.message = message
//     this.data = data
//   }
// }
export class Response {
  constructor(statusCode, httpStatus, message, data, meta = {}) {
    this.timeStamp = new Date().toLocaleString()
    this.statusCode = statusCode
    this.httpStatus = httpStatus
    this.message = message
    this.data = data
    this.success = statusCode >= 200 && statusCode < 300
    if (meta.action) this.action = meta.action // 'upserted' | 'deleted' | 'no-items' | 'unrouted' | 'no-load'
    if (meta.order) this.order = meta.order
    if (meta.reason) this.reason = meta.reason
  }
}
