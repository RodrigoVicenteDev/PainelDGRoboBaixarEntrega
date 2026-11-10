# Robô de baixa de entrega + comprovante (SSW)

Faz no SSW o que o Arquivo faz à mão. Agrupa por unidade de destino (unidade receptora do CTRC)
e, **para cada CTRC**, nesta ordem:

1. **038 Baixa de Entregas** → "Digitação de CTRC": **uma baixa**.
2. **398 Escanear Comprovante** → **uma subida por foto** (CTRC com várias NFs = várias fotos; o SSW aceita).
3. **040 Capa de Comprovantes** → "Gerar meus" (nunca "todos"): **uma capa por baixa**, igual à descarga
   do roboComplementar. Sai mesmo se alguma foto falhar (a baixa já existe; a foto é retentada depois).

## Dois modos

- **Produção (`node index.js`, sem argumento):** pega a fila na API Dago
  (`POST api/baixa-comprovante/robo/proximas`), baixa as fotos para `tmp/`, **enquadra** cada uma,
  roda 038 → 398 → 040 e devolve o resultado CTRC a CTRC (`POST .../robo/{id}/resultado`). Repete até a
  fila esvaziar. Quem chama é o **escutador** (chave `baixa-comprovante` → `run-baixa.sh`): o back dispara
  sozinho quando há baixa pronta (respiro de 2 min; se já estiver rodando, o lock segura).
- **Teste (`node index.js baixas.json`):** lê o arquivo, como na 1ª versão.

### Enquadrar a foto (`enquadrar.js`)
A IA do back (gpt-6.1-terra) devolve os 4 cantos do papel (0–1000) e a rotação; o robô corta com
perspectiva, gira e dá contraste leve antes da 398. Só usa o recorte se os cantos forem plausíveis
(dentro da foto, quadrilátero convexo, papel ≥ 15% da foto, lados não minúsculos) e com 2% de folga;
senão sobe a **original**. A leitura dos dados e a tela do Arquivo usam sempre a original.

## Rodar

```bash
npm install
npx playwright install chromium
cp .env.example .env      # preencher SITE_*, DAGO_*, ROBO_TOKEN
npm run ver               # produção com navegador + prints em debug/
npm start                 # produção headless
npm run teste             # modo arquivo (baixas.json) com navegador
```

## Entrada (`baixas.json`)

| Campo | Obrigatório | Observação |
|---|---|---|
| `ctrc` | sim | com sigla e DV: `CCM143231-1` |
| `unidade` | sim | unidade **receptora** (1ª sigla do rodapé do DACTE, ex. `FEC`). A baixa só é feita se a tela abrir nessa unidade |
| `data` | sim | data do canhoto: `04/11/2026`, `2026-11-04` ou `041126` |
| `hora` | não | `hhmm`; padrão `1200` |
| `codigo` | não | `01` (padrão) ou `17` (com ressalva). 36/68 nunca são automáticos |
| `recebedor` / `parentesco` | não | padrão `ASSINATURA` / `RUBRICA` (máx. 20) |
| `fotos` | sim | lista de caminhos (imagem ou PDF) |

O robô só deve receber CTRC **completo**: foto de todas as NFs e uma data só. Faltou NF ou as datas
divergem → é caso do Arquivo, não do robô.

## Saída

`resultados/resultado_<data>.json`, no mesmo formato da entrada, com o status de cada etapa
(gravado a cada passo: se o robô cair, o que já foi feito está lá):

- `baixa.status`: `ok` · `erro` (SSW recusou; mensagem do SSW) · `indefinido` (sem aviso e sem limpar: **conferir na 101**)
- `fotos[].status`: `ok` · `erro` (não subiu) · `indefinido` (arquivo foi entregue, sem confirmação: **conferir antes de reenviar**)
- `capa.status`: `ok` · `erro` (por CTRC)

**Rodar de novo com o arquivo de resultado** refaz só o que deu `erro` ou não foi feito:
baixa `ok` não é refeita; capa `ok` não é refeita; foto `ok`/`indefinido` não é reenviada (a 398 aceita foto repetida,
o SSW não trava duplicidade). Saída com código 1 se sobrou qualquer coisa diferente de `ok`.

## Como o robô confere cada tela

- **Unidade**: troca no campo Unidade do menu só quando muda e confere o cabeçalho (`#infodiv`) de cada tela.
- **038**: sucesso = sem aviso **e** número do CTRC/recebedor/parentesco limpos. Aviso = erro (ex.:
  "CTRC não cadastrado ou já entregue/baixado.").
- **398**: confere que abriu o CTRC certo (`h_ser_ctrc`/`h_num_ctrc`/`h_dig_ctrc`) **antes** de subir;
  sucesso = "Imagem carregada com sucesso." (aparece na tela inicial, a do CTe fecha).
- **040**: reaproveitado do `roboComplementar` (data de hoje no fuso do Brasil).
