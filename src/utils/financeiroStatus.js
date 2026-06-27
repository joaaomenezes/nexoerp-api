const FINANCEIRO_STATUS = Object.freeze({
  PENDENTE: 'pendente',
  A_VENCER: 'avencer',
  VENCIDO: 'vencida',
  PAGO: 'pago',
  RECEBIDO: 'recebido',
  CONCILIADO: 'conciliado',
  CANCELADO: 'cancelado',
  ESTORNADO: 'estornado',
});

const FINANCEIRO_STATUS_REALIZADOS = Object.freeze([
  FINANCEIRO_STATUS.PAGO,
  FINANCEIRO_STATUS.RECEBIDO,
  FINANCEIRO_STATUS.CONCILIADO,
]);

const FINANCEIRO_STATUS_INATIVOS = Object.freeze([
  FINANCEIRO_STATUS.CANCELADO,
  FINANCEIRO_STATUS.ESTORNADO,
]);

const FINANCEIRO_STATUS_ABERTOS = Object.freeze([
  FINANCEIRO_STATUS.PENDENTE,
  FINANCEIRO_STATUS.A_VENCER,
  FINANCEIRO_STATUS.VENCIDO,
]);

const FINANCEIRO_STATUS_VALIDOS = Object.freeze([
  ...FINANCEIRO_STATUS_ABERTOS,
  ...FINANCEIRO_STATUS_REALIZADOS,
  ...FINANCEIRO_STATUS_INATIVOS,
]);

function normalizarStatusFinanceiro(status) {
  return String(status || '').trim().toLowerCase();
}

function isStatusFinanceiroRealizado(status) {
  return FINANCEIRO_STATUS_REALIZADOS.includes(normalizarStatusFinanceiro(status));
}

function isStatusFinanceiroInativo(status) {
  return FINANCEIRO_STATUS_INATIVOS.includes(normalizarStatusFinanceiro(status));
}

function isLancamentoFinanceiroAberto(lancamento) {
  const status = normalizarStatusFinanceiro(lancamento?.status);
  return !isStatusFinanceiroRealizado(status) && !isStatusFinanceiroInativo(status);
}

module.exports = {
  FINANCEIRO_STATUS,
  FINANCEIRO_STATUS_ABERTOS,
  FINANCEIRO_STATUS_INATIVOS,
  FINANCEIRO_STATUS_REALIZADOS,
  FINANCEIRO_STATUS_VALIDOS,
  normalizarStatusFinanceiro,
  isStatusFinanceiroRealizado,
  isStatusFinanceiroInativo,
  isLancamentoFinanceiroAberto,
};
