export function successResponse(data, meta = {}) {
  return {
    success: true,
    data,
    meta
  };
}

export function errorResponse(code, message, details = {}) {
  return {
    success: false,
    error: {
      code,
      message,
      details
    }
  };
}
