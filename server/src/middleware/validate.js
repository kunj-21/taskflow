import { ApiError } from '../utils/errors.js';

// validate({ body, query, params }) — parsed values replace the raw ones so handlers get coerced types.
export const validate = (schemas) => (req, _res, next) => {
  for (const part of ['body', 'query', 'params']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part]);
    if (!result.success) {
      return next(ApiError.badRequest('Validation failed', result.error.flatten().fieldErrors));
    }
    req[part] = result.data;
  }
  next();
};
