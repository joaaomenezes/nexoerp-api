const providers = {
  mercadopago: require('./mercadoPago'),
};

function getPaymentProvider(name) {
  const provider = providers[name];
  if (!provider) {
    const error = new Error(`Provedor de pagamento nao suportado: ${name}`);
    error.status = 400;
    throw error;
  }
  return provider;
}

module.exports = { getPaymentProvider };
