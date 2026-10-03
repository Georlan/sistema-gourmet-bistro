import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const restaurant360 = readFileSync(
  new URL('../src/super-admin/SuperAdminRestaurant360.tsx', import.meta.url),
  'utf8',
);
const tenantsTab = readFileSync(
  new URL('../src/super-admin/SuperAdminTenantsTab.tsx', import.meta.url),
  'utf8',
);

test('Restaurante 360 usa somente fontes administrativas reais já existentes', () => {
  assert.match(restaurant360, /\/api\/super-admin\/trials/);
  assert.match(restaurant360, /\/api\/super-admin\/onboarding\/restaurantes\//);
  assert.match(restaurant360, /\/api\/super-admin\/access\/restaurantes\//);
  assert.match(restaurant360, /SuperAdminAuditTab key=\{tenant.id\} tenantId=\{tenant.id\}/);
  assert.match(restaurant360, /linkedRestaurantId === tenant\.id/);
  assert.doesNotMatch(restaurant360, /mock|faker|simulad/i);
});

test('Implantação vira cockpit operacional sem inventar readiness no frontend', () => {
  assert.match(restaurant360, /Cockpit de implantação/);
  assert.match(restaurant360, /Estados e blockers vêm das projeções canônicas do backend/);
  assert.match(restaurant360, /release\.readiness\?\.blockers/);
  assert.match(restaurant360, /release\.operations\?\.capabilities\?\.delivery/);
  assert.match(restaurant360, /release\.catalogAssistance/);
  assert.match(restaurant360, /Quem age:/);
  assert.match(restaurant360, /Evidência:/);
  assert.match(restaurant360, /<SuperAdminReleaseModal/);
  assert.match(restaurant360, /<SuperAdminTrialModal/);
});

test('Plano separa catálogo vigente, contrato congelado e benefícios individuais', () => {
  assert.match(restaurant360, /Plano de recursos atual/);
  assert.match(restaurant360, /Condições contratadas/);
  assert.match(restaurant360, /Mensalidade congelada/);
  assert.match(restaurant360, /Taxa online congelada/);
  assert.match(restaurant360, /Benefícios individuais não alteram automaticamente cobrança/);
  assert.match(restaurant360, /onBenefits\(tenant\)/);
});

test('Lista global usa filtros operacionais e empurra ações para a ficha 360', () => {
  assert.match(tenantsTab, /Todos os status/);
  assert.match(tenantsTab, /Todo pagamento online/);
  assert.match(tenantsTab, /selectedStatus/);
  assert.match(tenantsTab, /selectedPayment/);
  assert.match(tenantsTab, /Abrir 360°/);
  assert.doesNotMatch(tenantsTab, />Recursos\/Benefícios<\/button>/);
  assert.doesNotMatch(tenantsTab, />Editar<\/button>/);
});

test('Pagamentos distingue recebimento do restaurante da cobrança SaaS', () => {
  assert.match(restaurant360, /Mercado Pago do Cardápio Online/);
  assert.match(restaurant360, /Não representa mensalidade SaaS nem Pix anual da contratação/);
  assert.match(restaurant360, /nenhuma taxa é inferida/);
});


test('Equipe permite recuperar convite inicial usando o fluxo administrativo existente', () => {
  assert.match(restaurant360, /\/api\/super-admin\/signups\//);
  assert.match(restaurant360, /\/activation-invite/);
  assert.match(restaurant360, /Reemitir convite inicial/);
  assert.match(restaurant360, /linkedContract && access\?\.users\.some\(user => user\.role === "admin" && user\.status === "pendente_ativacao"\)/);
  assert.doesNotMatch(restaurant360, /token_convite|senha_hash|access_token/);
});


test('Restaurante 360 corrige modalidades pelo endpoint administrativo auditável sem copiar configuração especializada', () => {
  assert.match(restaurant360, /\/api\/super-admin\/onboarding\/restaurantes\//);
  assert.match(restaurant360, /\/operations/);
  assert.match(restaurant360, /method: "PUT"/);
  assert.match(restaurant360, /order_types: operationModes/);
  assert.match(restaurant360, /reason: operationReason\.trim\(\)/);
  assert.match(restaurant360, /Corrigir modalidades/);
  assert.match(restaurant360, /altera somente a política canônica de atendimento/);
  assert.match(restaurant360, /Delivery, mesas e outras configurações especializadas continuam separadas/);
});

test('Restaurante 360 incorpora incidentes operacionais reais do tenant sem inventar diagnóstico', () => {
  assert.match(restaurant360, /\/api\/super-admin\/incidents\?tenant_id=/);
  assert.match(restaurant360, /Incidentes operacionais deste restaurante/);
  assert.match(restaurant360, /impressão, Mercado Pago, Outbox\/integrações, acesso e estado do restaurante/);
  assert.match(restaurant360, /item\.recommended_action/);
  assert.match(restaurant360, /item\.detail/);
  assert.match(restaurant360, /incidentSourceLabel/);
  assert.match(restaurant360, /O painel não presume que o restaurante esteja saudável/);
  assert.match(restaurant360, /incidentsAvailable/);
  assert.doesNotMatch(restaurant360, /mockIncident|fakeIncident|simulatedIncident/);
});


test('Cockpit informa próximo passo e usa deep link de suporte para configuração canônica', () => {
  assert.match(restaurant360, /Próximo passo:/);
  assert.match(restaurant360, /supportTargetForCockpit/);
  assert.match(restaurant360, /Dados do restaurante/);
  assert.match(restaurant360, /Horários e pedidos online/);
  assert.match(restaurant360, /Salão \/ mesas/);
  assert.match(restaurant360, /Configuração de entrega/);
  assert.match(restaurant360, /Formas de pagamento/);
  assert.match(restaurant360, /onSupport\(tenant, target\)/);
  assert.match(restaurant360, /Corrigir tipo/);
  assert.match(restaurant360, /Gerenciar acessos/);
});


test('Restaurante 360 executa somente ações corretivas já oferecidas pelo diagnóstico real', () => {
  assert.match(restaurant360, /\/api\/super-admin\/incidents\/action/);
  assert.match(restaurant360, /tenant_id: incidentAction\.tenant_id/);
  assert.match(restaurant360, /action_type: incidentAction\.action_type/);
  assert.match(restaurant360, /target_id: incidentAction\.action_target_id/);
  assert.match(restaurant360, /reason: incidentReason\.trim\(\)/);
  assert.match(restaurant360, /incidentAction\?\.action_available/);
  assert.match(restaurant360, /Resolver com ação auditada/);
  assert.match(restaurant360, /A execução fica restrita ao tenant/);
  assert.doesNotMatch(restaurant360, /reprocess_outbox_event["']\s*:/);
  assert.doesNotMatch(restaurant360, /retry_print_job["']\s*:/);
});


test('Cardápio assistido reaproveita a fila existente em vez de duplicar publicação no 360', () => {
  assert.match(restaurant360, /onOpenCatalogAssistance/);
  assert.match(restaurant360, /Abrir fila de cardápios/);
  assert.match(restaurant360, /item\.key === "catalog"/);
  assert.doesNotMatch(restaurant360, /catalog-assistance.*\/publish/);
});


test('Restaurante 360 mostra impressão sem inventar saúde positiva', () => {
  assert.match(restaurant360, /\/api\/super-admin\/restaurantes\/.*\/capabilities/);
  assert.match(restaurant360, /key: "printing"/);
  assert.match(restaurant360, /printingIncidents/);
  assert.match(restaurant360, /Capability efetiva \+ ausência de incidente detectado/);
  assert.match(restaurant360, /Recurso habilitado · nenhum incidente de impressão detectado/);
  assert.match(restaurant360, /state: printingEnabled === false/);
  assert.match(restaurant360, /\? "check"/);
  assert.match(restaurant360, /Abrir a tela de impressão em Modo Suporte/);
  assert.match(restaurant360, /subTab: "impressao"/);
  assert.doesNotMatch(restaurant360, /Impressão pronta.*nenhum incidente/i);
});


test('Cockpit mostra contratação real e diferencia tenant comercial de administrativo', () => {
  assert.match(restaurant360, /key: "contract"/);
  assert.match(restaurant360, /linkedContract/);
  assert.match(restaurant360, /contractsAvailable/);
  assert.match(restaurant360, /Implantação comercial sem contrato vinculado/);
  assert.match(restaurant360, /Tenant administrativo\/QA · sem contratação comercial/);
  assert.match(restaurant360, /ContractAcceptance vinculado ao tenant/);
  assert.match(restaurant360, /Abrir contratações/);
  assert.doesNotMatch(restaurant360, /mockContract|fakeContract|simulatedContract/);
});


test('Restaurante 360 mostra status e expiração do convite sem expor segredo', () => {
  assert.match(restaurant360, /inviteEmailStatus/);
  assert.match(restaurant360, /inviteExpiresAt/);
  assert.match(restaurant360, /inviteExpired/);
  assert.match(restaurant360, /E-mail entregue/);
  assert.match(restaurant360, /Expirado/);
  assert.doesNotMatch(restaurant360, /token_convite/);
});


test('Cockpit traduz blockers canônicos para linguagem operacional sem inventar estado', () => {
  assert.match(restaurant360, /READINESS_BLOCKER_LABELS/);
  assert.match(restaurant360, /Dados do restaurante pendentes/);
  assert.match(restaurant360, /Horários de funcionamento pendentes/);
  assert.match(restaurant360, /Cardápio ainda sem produto ativo/);
  assert.match(restaurant360, /Aguardando revisão e liberação KÔMA/);
  assert.match(restaurant360, /OPERATION_BLOCKER_LABELS/);
  assert.match(restaurant360, /Modalidades de atendimento não configuradas/);
  assert.match(restaurant360, /Salão usa mapa de mesas, mas não há mesas cadastradas/);
  assert.match(restaurant360, /Delivery ativo com configuração de entrega incompleta/);
  assert.match(restaurant360, /Taxa de serviço ativa com percentual inválido/);
  assert.match(restaurant360, /formatBlockers\(release\.readiness\.blockers, READINESS_BLOCKER_LABELS\)/);
  assert.match(restaurant360, /formatBlockers\(release\.operations\.blockers, OPERATION_BLOCKER_LABELS\)/);
});


test('Resumo do Restaurante 360 destaca o próximo passo usando readiness canônico', () => {
  assert.match(restaurant360, /Próximo passo da implantação/);
  assert.match(restaurant360, /Implantação essencial pronta · aguardando revisão KÔMA/);
  assert.match(restaurant360, /Fonte: readiness canônico do onboarding/);
  assert.match(restaurant360, /formatBlockers\(release\.readiness\.blockers, READINESS_BLOCKER_LABELS\)/);
  assert.match(restaurant360, /setSection\("implementation"\)/);
});
