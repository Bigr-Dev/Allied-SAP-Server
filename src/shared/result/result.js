/**
 * Common Result pattern for standardized error handling
 */

export class Result {
  constructor(success, data = null, error = null) {
    this.success = success
    this.data = data
    this.error = error
  }

  static success(data) {
    return new Result(true, data, null)
  }

  static error(error, statusCode = 500) {
    const errorObj = typeof error === 'string' 
      ? { message: error, statusCode } 
      : { ...error, statusCode: error.statusCode || statusCode }
    return new Result(false, null, errorObj)
  }

  static fromServiceCall(serviceFunction) {
    return async (...args) => {
      try {
        const data = await serviceFunction(...args)
        return Result.success(data)
      } catch (error) {
        return Result.error(error)
      }
    }
  }
}

export function handleServiceResult(result, res, successMessage = 'Success') {
  if (result.success) {
    const statusCode = result.data?.statusCode || 200
    return res.status(statusCode).json({
      status: statusCode,
      message: successMessage,
      data: result.data
    })
  } else {
    const statusCode = result.error?.statusCode || 500
    return res.status(statusCode).json({
      status: statusCode,
      message: result.error?.message || 'Internal Server Error',
      error: result.error
    })
  }
}