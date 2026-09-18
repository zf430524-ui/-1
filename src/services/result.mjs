export const success = (data, meta = {}) => ({ ok: true, status: 'success', data, meta });
export const partial = (data, errors, meta = {}) => ({ ok: true, status: 'partial', data, errors, meta });
export const failure = (code, message, details = {}) => ({ ok: false, status: 'failure', error: { code, message, details } });
