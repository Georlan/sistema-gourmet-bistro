import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('customer signup uses email confirmation instead of WhatsApp OTP in the happy path', () => {
  const source = readFileSync(
    'src/cardapio/components/CardapioAuthModal.tsx',
    'utf8',
  );

  assert.match(source, /\/cardapio\/clientes\/cadastro\/solicitar/);
  assert.match(source, /Enviamos um link de confirmação/);
  assert.match(source, /Criar conta/);
  assert.doesNotMatch(source, /\/cardapio\/clientes\/otp\/solicitar/);
  assert.doesNotMatch(source, /Enviar código pelo WhatsApp/);
});

test('registration confirmation route clears the secret before monitoring and supports protected guest linking', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  const page = readFileSync(
    'src/components/auth/CustomerRegistrationConfirmPage.tsx',
    'utf8',
  );

  const tokenBootstrap = main.indexOf(
    'import "./components/auth/customerRegistrationToken";',
  );
  const monitoring = main.indexOf('@sentry/react');

  assert.ok(tokenBootstrap >= 0);
  assert.ok(monitoring > tokenBootstrap);
  assert.match(main, /pathname === "\/confirmar-cadastro"/);
  assert.match(page, /\/cardapio\/clientes\/cadastro\/confirmar/);
  assert.match(page, /\/cardapio\/clientes\/cadastro\/telefone\/solicitar/);
  assert.match(page, /\/cardapio\/clientes\/cadastro\/telefone\/confirmar/);
  assert.match(page, /saveCustomerSession/);
});
