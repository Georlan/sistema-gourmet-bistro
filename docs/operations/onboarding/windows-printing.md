# Impressão no Windows — roteiro de campo

Fonte canônica: [Print Agent na main](https://github.com/Georlan/sistema-gourmet-bistro/blob/main/print-agent/README.md)
e [install-windows.ps1 atual](https://github.com/Georlan/sistema-gourmet-bistro/blob/main/print-agent/install-windows.ps1).
Os comandos abaixo buscam a **main atual**; não salvar instalador em anexo nem
usar ZIP antigo como versão de implantação.

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

Abra **PowerShell** como o usuário que operará o computador, com internet, e execute:

```powershell
irm https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-windows.ps1 | iex
```

1. Aguarde download, preparação e abertura do navegador. Não fechar a janela antes do diagnóstico final.
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

Faça fora do turno, com fila conferida e cliente avisado. Use o mesmo usuário Windows:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-windows.ps1'))) -Update
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
4. Agente antigo/erro de dependências: atualizar pela main e repetir diagnóstico/teste.
5. Job pendente/falho: guardar ID, hora, estado e erro. Confira se houve papel antes de reimprimir pela ação do painel; não apagar jobs, journal ou credenciais.
6. Sem recuperação: seguir [incidentes](../first-client-incident-response.md); registrar bloqueio, responsável e prazo. Logs compartilhados devem ter segredos/dados pessoais removidos.
