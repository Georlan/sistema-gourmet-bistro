# Protocolo ChatGPT + Gemini

O Gemini é usado como executor visual e simulador de fluxo, não como auditor passivo.

Quando receber um prompt desta frente, ele deve:

1. abrir a aplicação publicada depois do merge indicado;
2. executar exatamente o fluxo pedido em mobile e desktop quando aplicável;
3. clicar, preencher, avançar e tentar quebrar o fluxo;
4. se encontrar problema reproduzível e tiver acesso ao repositório, corrigir diretamente em branch/PR pequeno com teste; se não tiver como alterar o código, devolver passos exatos, tela, ação, resultado esperado e resultado obtido;
5. não pedir ao ChatGPT para auditar de volta o que ele mesmo poderia testar;
6. não inventar regra financeira, estoque ou estado do backend para fazer a UI passar.

O ChatGPT continua responsável por resolver diretamente o máximo possível no repositório antes de pedir qualquer validação visual adicional.
