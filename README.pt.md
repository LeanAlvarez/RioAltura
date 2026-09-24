# Rio Uruguai em Colón

[Español](README.md) · [English](README.en.md) · **Português**

Aplicação web pública que mostra o estado do rio Uruguai na sua passagem por **Colón, Entre
Ríos, Argentina**: a que altura está o rio, se isso é perigoso, o que vem nos próximos dias, e
quais zonas da cidade alagam a cada altura.

**Em produção: [rio.miraisoftware.net](https://rio.miraisoftware.net)**

Foi pensada para dois públicos bem diferentes: **moradores com um celular de 360 px e conexão
ruim**, e a **Defensa Civil** (defesa civil local). Isso explica quase todas as decisões de
projeto — desde o mapa que carrega suas camadas sob demanda até o fato de a primeira tela
responder a uma única pergunta: *preciso me preocupar?*

A interface está em espanhol rio-platense, que é a língua de quem a usa. Este documento está
em português para que o projeto possa ser lido, reaproveitado e adaptado em outros lugares —
inclusive do lado brasileiro da bacia.

## O que faz

- **Altura atual da régua do porto**, com o horário da medição e de qual fonte veio. Uma
  cadeia de três fontes oficiais: INA → Prefectura Naval → CARU.
- **Previsão de 7 dias** do Google Flood Forecasting, convertida para metros no porto e
  sempre exibida **como faixa**, nunca como um número exato.
- **Mapa de zonas alagáveis**, com 43 camadas calculadas a partir do MDE Copernicus GLO-30 e
  um controle para ver o que acontece a cada altura.
- **"Mi casa"** ("minha casa"): marca-se um ponto no mapa e o app informa a que altura do rio
  aquele ponto alaga. O cálculo roda no navegador — **a coordenada nunca sai do dispositivo**.
- **Alertas por Telegram**: um canal público com as mudanças de nível e avisos pessoais quando
  o rio cruza uma altura escolhida por cada pessoa.
- **Dados de Salto Grande**: vazão liberada, nível do reservatório e chuva na bacia alta.

## Como está montado

```
worker (cron) ─► Postgres ─► API FastAPI ─► Web (estática)
    │                                        ▲
    └─ Telegram            camadas GeoJSON servidas pelo nginx
```

- `worker/` — busca os dados nas fontes externas. **É o único componente que vê as
  credenciais.**
- `backend/` — FastAPI. Só lê do Postgres; **nunca chama uma API externa** ao atender uma
  requisição.
- `frontend/` — Vite + TypeScript + Leaflet + uPlot.
- `geoprocessing/` — scripts offline que geram as camadas do mapa.
- `specs/` — uma spec por mudança, com sua verificação. É onde está escrito o *porquê*.

As regras de domínio (limiares, curva vazão→altura, zero da régua) ficam em
[`CLAUDE.md`](CLAUDE.md) e em `backend/app/config/dominio.py`. **Não se alteram sem uma
spec**: vêm de fontes verificadas ou de calibração própria, e algumas ainda são provisórias.

---

## Credenciais: isso é responsabilidade de quem implanta

> [!IMPORTANT]
> Este repositório **não inclui nenhuma chave** e não funciona por completo sem elas. Obtê-las
> e administrá-las é responsabilidade de quem implantar a própria cópia.

### Google Flood Forecasting (obrigatória para a previsão)

A previsão vem da **Flood Forecasting API** do Google — o mesmo sistema por trás do
[Flood Hub](https://sites.research.google/floods/). É preciso ter a sua própria chave:

1. Solicitar acesso à API e habilitá-la em um projeto do Google Cloud.
2. Gerar uma chave e colocá-la em `FLOODS_API_KEY`.

Sem essa chave o worker registra a falha e **o resto do app continua funcionando**: a altura
real segue visível, junto com um aviso de que a previsão não está disponível. Essa degradação
é intencional, não um acidente.

Os dados do Google são publicados sob **CC BY 4.0** e a atribuição é obrigatória: já está no
rodapé do app e, se você modificá-lo, precisa mantê-la.

### Telegram (opcional)

Para o canal e os avisos são necessários um bot do [@BotFather](https://t.me/BotFather) e seu
token em `TELEGRAM_BOT_TOKEN`. Sem token, essa parte simplesmente não é ativada.

### Regras que convém não quebrar

- **`FLOODS_API_KEY` e `TELEGRAM_BOT_TOKEN` vivem apenas no worker.** Nunca no frontend, nos
  logs, nas fixtures ou em um commit.
- **Os testes nunca chamam as APIs reais**: usam fixtures gravadas em `tests/fixtures/`.
- Se algum dia você colar um token em um chat ou em uma issue, **rotacione-o**.

---

## Baixar e modificar

Requisitos: **Docker**, [`uv`](https://docs.astral.sh/uv/), **Node 20** e `pnpm`
(`corepack enable pnpm`). O `uv` instala o Python 3.12 sozinho.

```bash
git clone https://github.com/LeanAlvarez/RioAltura.git
cd RioAltura

scripts/wt-env.sh          # gera .env.local com portas únicas
```

Abra o `.env.local` e preencha ao menos `FLOODS_API_KEY`. Depois:

```bash
docker compose up -d --build     # db + api + worker + web
uv run alembic upgrade head      # cria as tabelas

curl "http://localhost:$(rg '^API_PORT=' .env.local | cut -d= -f2)/health"
# {"status":"ok","db":"ok"}
```

### Carregue os dados históricos: não é opcional

Um banco novo começa vazio e o worker só coleta dados **daqui para frente**. Sem esse passo, o
app compara a previsão contra quase nada e exibe um erro médio **melhor do que o real** — isso
aconteceu de verdade: com 7 dias de amostra dizia errar 0,38 m; com 91, eram 0,50 m.

Num app de alerta de enchente, um número de confiança inflado é exatamente o dano que o app
existe para evitar.

```bash
uv run --directory worker python -m jobs.ina backfill --desde 2023-01-01
uv run --directory worker python -m jobs.google backfill --desde 2024-07-08
```

### Desenvolver sem contêineres

Com o banco do compose no ar:

```bash
uv sync
uv run uvicorn app.main:app --app-dir backend --reload --port "$(rg '^API_PORT=' .env.local | cut -d= -f2)"
uv run --directory worker python -m jobs
pnpm -C frontend install && pnpm -C frontend dev
```

### Verificar antes de abrir um PR

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest
pnpm -C frontend build && pnpm -C frontend test
```

> O `ruff format` também alcança os blocos ` ```python ` dentro dos `.md` em `specs/`.
> Rodar só `ruff check` não basta.

### Implantar

O [`DEPLOY.md`](DEPLOY.md) traz o procedimento completo para Dokploy em VPS próprio: variáveis
separando segredos de configuração, domínio com HTTPS e o backfill inicial.

---

## Como trabalhamos

Uma tarefa = uma spec = um branch = um PR. Cada spec em [`specs/`](specs/) traz seus critérios
de aceitação, como verificá-los e os achados do caminho — inclusive os erros, que costumam ser
a parte mais útil de ler.

Há uma regra que atravessa todo o projeto e vale entender antes de mexer no código:

> **Uma previsão nunca é mostrada com cara de medição.**

Dela saem a faixa em vez do número exato, as cores das séries validadas para que não se
confundam entre si, a quarentena de leituras implausíveis, e a data visível ao lado de cada
dado.

## Dados e atribuição

- **Google Flood Forecasting** — CC BY 4.0
- **Copernicus DEM GLO-30** — camadas de inundação
- **INA** (`alerta.ina.gob.ar`), **Prefectura Naval Argentina**, **CARU** — alturas do porto
- **CTM Salto Grande** — vazões e chuva da bacia
- **OpenStreetMap / CARTO** e **Esri** — mapas base

O app é **indicativo e não substitui a Prefectura, a CARU nem a Defensa Civil**. Esse aviso é
obrigatório em toda tela que mostre previsão ou mapa: se você modificar o app, mantenha-o.

## Quem desenvolveu

Desenvolvido pela **[Mirai Software](https://miraisoftware.net)**, na e para a cidade de
Colón, Entre Ríos, Argentina.
