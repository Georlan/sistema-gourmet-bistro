import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('fluxo moderno de inscricao em planos esta disponivel para /contratar', () => {
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(planContract, /Escolha um plano/);
  assert.match(planContract, /Experimente o.*grátis/);
  assert.match(planContract, /Recorrente/);
  assert.match(planContract, /Único/);
});

test('etapa 1 exibe as opcoes de cobranca mensal e anuais com trial de 7 dias', () => {
  assert.match(planContract, /Plano mensal/);
  assert.match(planContract, /Plano anual \(pagamento único\)/);
  assert.match(planContract, /Plano anual \(parcelado em 12x\)/);
  assert.match(planContract, /Aproveite grátis por 7 dias, cancele quando quiser/);
  assert.match(planContract, /Vamos te lembrar antes do fim do seu período de teste/);
  assert.match(planContract, /Próximo/);
});

test('etapa 2 oferece cartao, nupay, pix automatico e mercado pago com tratamento de erro', () => {
  assert.match(planContract, /Cartão de crédito ou débito/);
  assert.match(planContract, /NuPay/);
  assert.match(planContract, /Pix Automático/);
  assert.match(planContract, /mercado pago/);
  assert.match(planContract, /Faça um teste gratuito/);
  assert.match(planContract, /Não foi possível processar o seu pagamento/);
});

test('modal de conexao qr code mercado pago e pix esta disponivel', () => {
  assert.match(planContract, /Conexão com Mercado Pago/);
  assert.match(planContract, /Escaneie o QR Code para conectar com KÔMA BR/);
  assert.match(planContract, /Não feche esta janela até concluir a conexão/);
  assert.match(planContract, /QRCodeSVG/);
  assert.match(planContract, /continuar neste navegador/);
});

test('timeline de degustacao calcula hoje, lembrete e renovacao dinamicamente', () => {
  assert.match(planContract, /Hoje/);
  assert.match(planContract, /Tenha acesso grátis a tudo que o.*oferece/);
  assert.match(planContract, /Enviaremos um lembrete quando seu período de teste estiver prestes a terminar/);
  assert.match(planContract, /Seu plano será renovado automaticamente/);
  assert.match(planContract, /A pagar hoje/);
  assert.match(planContract, /Teste grátis de 7 dias/);
});

test('estilos do fluxo moderno estao integrados', () => {
  assert.match(planStyles, /\.koma-sub-wrapper/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.match(planStyles, /\.koma-sub-cards/);
  assert.match(planStyles, /\.koma-sub-modal/);
});
