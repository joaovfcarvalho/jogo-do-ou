# Jogo do Ou

Você prefere isso ou aquilo? Site estático (GitHub Pages) com banco no Supabase.

## Como funciona

- **Alternativas**: as 437 da planilha do João e do Bruno (nota 1 a 5 = intensidade:
  quão boa ou quão ruim), mais as que a galera sugerir no próprio jogo.
- **Pareamento**: sorteia a opção A e procura uma B de peso parecido, para o dilema
  ficar difícil (dá para desligar e jogar no aleatório puro).
- **Três jogos**: boa ou boa, ruim ou ruim, e boa com ruim (cada lado vem com um
  prêmio e um castigo).
- **As notas aprendem com os votos** (modelo de Bradley-Terry):
  P(escolher A) = 1 / (1 + e^(-(U_A - U_B) / 0,8)), com U = nota da boa menos nota
  da ruim. Cada voto move as notas em 0,15 × (resultado − previsão).
- **Salas**: cada um vota no próprio celular; a rodada se revela quando todos os
  presentes votaram. A partida tem 5, 10, 15 ou 20 rodadas (dá para terminar antes).
- **Fim de jogo**: destaques da mesa (quem mais ficou na minoria, almas gêmeas, a
  rodada que mais rachou, unanimidades) e um cartão por pessoa, com perfil ("Do
  contra", "Maria vai com as outras", "Lobo solitário"...), os números e uma
  previsão no estilo horóscopo sorteada pelas próprias escolhas.
- **Sem graça**: três sinalizações tiram a alternativa do jogo.

## Arquivos

- `index.html`, `css/estilo.css`: a página.
- `js/pareamento.js`: montagem dos pares e regra do voto (funções puras, testadas).
- `js/resultado.js`: números, perfis, previsões e destaques do fim da partida
  (funções puras, testadas; todo celular da sala chega ao mesmo resultado).
- `js/api.js`: chamadas ao Supabase (REST, sem biblioteca).
- `js/app.js`: telas, jogo solo e salas.
- `js/config.js`: endereço do banco e chave publicável.
- `supabase/schema.sql`: tabelas, RLS e funções. O site só lê `alternativas`;
  tudo o que escreve passa pelas funções, que validam o que chega.
- `supabase/migracoes/`: as mudanças aplicadas no banco depois da primeira versão.
- `.github/workflows/manter-ativo.yml`: consulta o banco a cada 3 dias para o
  plano gratuito do Supabase não pausar o projeto.

## Testes

```bash
npm test
```
