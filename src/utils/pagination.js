const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getPagination(query, options = {}) {
  const enabled = query.page !== undefined || query.limit !== undefined || query.perPage !== undefined;
  if (!enabled) {
    return { enabled: false, prisma: {}, meta: () => null };
  }

  const maxLimit = options.maxLimit || MAX_LIMIT;
  const fallbackLimit = options.defaultLimit || DEFAULT_LIMIT;
  const page = parsePositiveInt(query.page) || 1;
  const requestedLimit = parsePositiveInt(query.limit) || parsePositiveInt(query.perPage) || fallbackLimit;
  const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);
  const skip = (page - 1) * limit;

  return {
    enabled: true,
    page,
    limit,
    skip,
    take: limit,
    prisma: { skip, take: limit },
    meta(total) {
      const totalPages = Math.max(1, Math.ceil(total / limit));
      return {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    },
  };
}

async function findManyPaginated(model, query, args, options) {
  const pagination = getPagination(query, options);
  if (!pagination.enabled) {
    const data = await model.findMany(args);
    return { data, pagination: null };
  }

  const [data, total] = await Promise.all([
    model.findMany({ ...args, ...pagination.prisma }),
    model.count({ where: args.where }),
  ]);

  return { data, pagination: pagination.meta(total) };
}

function sendList(res, result) {
  const payload = { ok: true, data: result.data };
  if (result.pagination) payload.pagination = result.pagination;
  return res.json(payload);
}

module.exports = { getPagination, findManyPaginated, sendList };
