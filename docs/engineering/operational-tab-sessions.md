# Sessões operacionais por aba

Token, identidade, restaurante, cargo e portal operacionais ficam em sessionStorage. Atualizar a aba restaura sua própria sessão; entrar ou sair em outra aba não altera o contexto das requisições, polling ou WebSocket desta aba. O endereço continua app.komafood.com.br para todos os perfis.

A sessão anterior em localStorage não pode ser migrada automaticamente: outro login pode já ter substituído o token e a identidade. A nova versão descarta autenticação compartilhada e exige novo login nas abas antigas. Não é possível recuperar com segurança o restaurante original da aba anterior pela sessão sobrescrita.

Uma aba nova sem sessão abre no login. Abas duplicadas ou abertas com opener podem receber uma cópia inicial de sessionStorage pelo navegador; as cópias são independentes depois disso, e sair de uma permite entrar em outra conta sem alterar a original. Fechar a aba encerra esse armazenamento, sujeito à restauração de sessões do navegador. O vencimento do JWT e a autorização de cargo/restaurante no backend continuam obrigatórios.

Caches de nome, configurações e mesa selecionada também são locais à aba. Preferências gerais, como tema e tamanho de fonte, continuam compartilhadas. sessionStorage isola o estado das abas; não cria uma fronteira contra scripts da mesma origem. A fronteira de autorização de dados permanece o JWT validado e o tenant no backend.
