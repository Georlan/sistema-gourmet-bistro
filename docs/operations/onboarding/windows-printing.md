# Impressão no Windows — roteiro de campo

Fonte canônica interna: [Print Agent](../../../print-agent/README.md)
e [install-windows.ps1](../../../print-agent/install-windows.ps1).
Use o ZIP público oficial de distribuição **produzido a partir da main
aprovada** no workflow `Publish public Print Agent release` e publicado
como GitHub Release em um **repositório público separado**. Enquanto este
repositório não tiver sido criado/publicado e validado, use o ZIP interno
entregue pelo suporte (workflow `Print agent`). Nunca forneça tokens
GitHub a clientes nem compartilhe checkout completo do backend. Confira
a integridade do ZIP com o SHA-256 registrado na execução que o gerou.

## Pré-requisitos

- Impressão efetiva liberada no tenant, inclusive override no Pocket.
- Usuário Windows que ficará conectado durante o expediente; tarefa inicia no **logon**, não antes de entrar no usuário.
- Internet e navegador com administrador do restaurante certo para parear.
- Impressora térmica ESC/POS conectada, ligada, com papel e fila física instalada no Spooler. Faça primeiro um teste do Windows/driver.
- Python 3.10+; se ausente, instalador tenta Python 3.12 pelo winget no perfil do usuário. Se winget não existir/falhar, instalar Python 3.10+ e repetir.

Não avançar se o Windows não conseguir imprimir ou se houver apenas fila PDF/virtual.
Use a fila existente do fabricante/Anota AI; não criar duas filas na mesma porta
USB. O KÔMA memoriza o nome da fila e não altera a impressora padrão.

## Instalar e parear

Baixe a release oficial publicada no repositório público do Print Agent
(endereço divulgado pela equipe KÔMA) ou receba o ZIP validado do suporte.
Confira o SHA-256 com o manifesto de verificação disponibilizado. Extraia todos os arquivos e dê dois
cliques em `INSTALAR-KOMA-WINDOWS.cmd` na pasta extraída, usando o
usuário que operará o computador. O instalador deve encontrar a pasta
`print-agent` ao lado do arquivo `.cmd`. Não use o antigo instalador
`raw.githubusercontent.com`, que exige repositório público.

1. Aguarde preparação e abertura do navegador. Não fechar a janela antes do diagnóstico final.
2. No pareamento, confira nome/ID do restaurante e autorize o computador; não autorizar se estiver no tenant errado.
3. Resultado esperado: agente em segundo plano com `pythonw.exe`, tarefa `KomaPrintAgent` e atalho `koma-print://`, sem terminal permanente.
4. No KÔMA, abra **Configurações → Impressão** (painel também chamado Salão e impressão). Confirme agente online e impressora física pelo **nome exato**.
5. Confirme destinos cozinha/bar/conta conforme uso, largura e corte. Se nenhuma fila física aparecer, diagnostique antes de criar pedido.

Instalação fica em `$env:LOCALAPPDATA\KomaPrintAgent`; credenciais ficam em
`$env:APPDATA\Koma\PrintAgent`. Não copiar credenciais para outro computador,
chat ou relatório.

## Diagnóstico local e teste físico

Depois de instalar, execute no PowerShell:

```powershell
& "$env:LOCALAPPDATA\KomaPrintAgent\check-windows.ps1"
Get-ScheduledTask -TaskName KomaPrintAgent
Get-Printer | Select-Object Name, PortName, PrinterStatus
```

Esperado: agente instalado, tarefa `Running`/`Ready`, fila memorizada com nome
correto. `Ready` sozinho não comprova processo vivo: confira agente online no
painel e saída física. O diagnóstico é informativo, não aceite de hardware.

1. Clique **Imprimir teste** e acompanhe o papel. Confira acentos, legibilidade, largura e corte.
2. Crie pedido controlado com adicional/observação e destinos usados; imprima conta quando aplicável. Compare pedido, PrintJobs e papel.
3. Se conviver com Anota AI, imprima um teste nele e outro no KÔMA; confirmar dois cupons completos sem mistura/duplicidade.
4. Teste impressora desligada e falta de papel, recuperação sem job perdido/duplicidade. Não disparar repetidamente novos testes/reimpressões quando o estado for incerto.
5. **Reinicie Windows, entre no mesmo usuário**, sem abrir terminal manual. Repita diagnóstico, confira agente online e imprima novo cupom.

Não concluir aceite sem papel e reinício aprovados. `printed` prova aceitação
pelo sistema operacional; não prova saída física. O [gate de aceite](../first-client-acceptance.md)
define casos/evidências; preflight usa o Python do agente instalado:

```powershell
& "$env:LOCALAPPDATA\KomaPrintAgent\.venv\Scripts\python.exe" "$env:LOCALAPPDATA\KomaPrintAgent\hardware_preflight.py" --report "$env:TEMP\koma-hardware-preflight.json"
```

Exige `status: PASSED`; `BLOCKED` impede aceite. Se este diagnóstico não conseguir
confirmar o hardware da conexão usada, registrar bloqueio e chamar suporte;
status de fila não substitui confirmação física.

## Atualizar futuramente

Faça fora do turno, com fila conferida e cliente avisado. Baixe a **nova versão** do ZIP na distribuição pública oficial
ou receba o ZIP do suporte; valide o SHA-256 do arquivo, extraia todo o conteúdo e use o mesmo usuário Windows.
Execute `ATUALIZAR-KOMA-WINDOWS.cmd` a partir da nova pasta extraída.
Depois execute:

```powershell
& "$env:LOCALAPPDATA\KomaPrintAgent\check-windows.ps1"
```

O instalador atualiza arquivos/dependências, recria a tarefa e preserva
credenciais/configuração. Depois confirme agente online, fila e teste físico;
repita logon/reinício quando validar atualização para operação. Se a atualização
falhar, guardar erro e corrigir a causa antes de repetir; não apagar credenciais.

## Quando não imprimir

1. Windows/driver imprime? Se não: energia, papel, cabo, fila pausada/offline e driver. Não culpar o pedido antes de testar localmente.
2. Há agente online no tenant correto? Execute diagnóstico e, se necessário:

   ```powershell
   Start-ScheduledTask -TaskName KomaPrintAgent
   Get-Content "$env:APPDATA\Koma\PrintAgent\agent.log" -Tail 80
   ```

3. Confira rede, pareamento, nome da fila memorizada e destino do job no monitor de impressão do KÔMA.
4. Agente antigo/erro de dependências: atualizar pelo ZIP novo validado e repetir diagnóstico/teste.
5. Job pendente/falho: guardar ID, hora, estado e erro. Confira se houve papel antes de reimprimir pela ação do painel; não apagar jobs, journal ou credenciais.
6. Sem recuperação: seguir [incidentes](../first-client-incident-response.md); registrar bloqueio, responsável e prazo. Logs compartilhados devem ter segredos/dados pessoais removidos.
