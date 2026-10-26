// Testes do resultado da partida (node:test, sem dependências).
const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/resultado.js');

// "Ana:a Bia:b" vira uma rodada com os votos nessa ordem.
function partida(linhas) {
  return linhas.map((linha, i) => ({
    rodada: 20 + i,
    opcao_a: { boa: null, ruim: 100 + i },
    opcao_b: { boa: null, ruim: 200 + i },
    votos: linha.split(' ').map(v => { const [jogador, escolha] = v.split(':'); return { jogador, escolha }; })
  }));
}

const nomeDoLado = (r, lado) => '“' + lado.toUpperCase() + (r.rodada - 19) + '”';

// Quatro pessoas: Duda fica sozinha várias vezes, Caio vai sempre com a maioria,
// Bia fica muito na minoria e Ana quase sempre acompanha a mesa.
const QUATRO = partida([
  'Ana:a Bia:b Caio:a Duda:b', // 2 a 2: ninguém tem maioria
  'Ana:a Bia:a Caio:a Duda:b', // Duda sozinha
  'Caio:b Ana:b Bia:b Duda:a', // Duda sozinha
  'Caio:a Ana:a Bia:b Duda:a', // Bia sozinha
  'Caio:a Ana:a Bia:a Duda:a', // unanimidade
  'Caio:b Bia:a Ana:b Duda:a', // 2 a 2
  'Caio:a Ana:b Bia:a Duda:a'  // Ana sozinha
]);

function porNome(res) {
  return Object.fromEntries(res.jogadores.map(j => [j.nome, j]));
}

test('conta maioria, minoria e quem ficou sozinho', () => {
  const j = porNome(R.calcular(QUATRO, { semente: 'X:1', nomeDoLado }));
  assert.deepStrictEqual([j.Duda.votos, j.Duda.maioria, j.Duda.minoria, j.Duda.sozinho], [7, 3, 2, 2]);
  assert.deepStrictEqual([j.Bia.maioria, j.Bia.minoria, j.Bia.sozinho], [4, 1, 1]);
  assert.deepStrictEqual([j.Caio.maioria, j.Caio.minoria], [5, 0]);
  assert.deepStrictEqual([j.Ana.maioria, j.Ana.minoria, j.Ana.sozinho], [4, 1, 1]);
  assert.strictEqual(j.Caio.primeiro, 5);
});

test('perfis seguem os números de cada pessoa', () => {
  const j = porNome(R.calcular(QUATRO, { semente: 'X:1', nomeDoLado }));
  assert.strictEqual(j.Duda.perfil.titulo, 'Lobo solitário');
  assert.strictEqual(j.Caio.perfil.titulo, 'Maria vai com as outras');
  assert.strictEqual(j.Ana.perfil.titulo, 'Termômetro da mesa');
  assert.match(j.Ana.perfil.frase, /Pergunte a Ana/);
});

test('do contra quando fica na minoria em metade das rodadas que racharam', () => {
  const res = R.calcular(partida([
    'Ana:a Bia:a Caio:a Duda:b Eva:b',
    'Ana:b Bia:a Caio:a Duda:a Eva:b',
    'Ana:a Bia:a Caio:a Duda:a Eva:a',
    'Ana:a Bia:b Caio:a Duda:a Eva:b'
  ]), { semente: 'Y:1', nomeDoLado });
  const j = porNome(res);
  assert.deepStrictEqual([j.Eva.minoria, j.Eva.sozinho], [3, 0]);
  assert.strictEqual(j.Eva.perfil.titulo, 'Do contra');
  assert.strictEqual(j.Eva.perfil.frase, 'Ficou na minoria em 3 das 3 rodadas em que a mesa rachou.');
  const fora = res.destaques.find(d => d.titulo === 'Fora da curva');
  assert.strictEqual(fora.texto, 'Eva ficou na minoria 3 vezes, mais do que todo mundo.');
});

test('mesa de duas pessoas compara uma com a outra', () => {
  const res = R.calcular(partida([
    'Ana:a Bia:a', 'Ana:b Bia:b', 'Bia:a Ana:a', 'Ana:b Bia:a', 'Ana:a Bia:a'
  ]), { semente: 'Z:1', nomeDoLado });
  const j = porNome(res);
  assert.strictEqual(j.Ana.maioria + j.Ana.minoria, 0, 'com dois votos não há maioria');
  assert.strictEqual(j.Ana.perfil.titulo, 'Alma gêmea');
  assert.deepStrictEqual(j.Ana.parecido, { nome: 'Bia', iguais: 4, juntos: 5 });
  assert.ok(res.destaques.some(d => d.titulo === 'Almas gêmeas' && /Ana e Bia votaram igual em 4 de 5/.test(d.texto)));
});

test('quem votou pouco vira turista', () => {
  const j = porNome(R.calcular(partida(['Ana:a Bia:b Caio:a', 'Ana:a Caio:b', 'Ana:b Caio:b', 'Ana:a Caio:a']), { nomeDoLado }));
  assert.strictEqual(j.Bia.perfil.titulo, 'Turista');
  assert.match(j.Bia.perfil.frase, /só 1 rodada\./);
});

test('destaques da mesa: rodada mais dividida e unanimidades', () => {
  const res = R.calcular(QUATRO, { semente: 'X:1', nomeDoLado });
  const titulos = res.destaques.map(d => d.titulo);
  assert.ok(titulos.includes('A que mais rachou a mesa'));
  assert.strictEqual(res.destaques.find(d => d.titulo === 'A que mais rachou a mesa').texto, '“A1” ou “B1”: 2 a 2.');
  assert.strictEqual(res.destaques.find(d => d.titulo === 'Unanimidade').texto, 'Todo mundo concordou em 1 de 7 rodadas.');
  assert.strictEqual(res.destaques.find(d => d.titulo === 'Gatilho mais rápido').texto, 'Caio votou primeiro em 5 rodadas.');
});

test('previsões: iguais em todo celular, uma diferente para cada pessoa, citando uma escolha', () => {
  const um = R.calcular(QUATRO, { semente: 'X:1', nomeDoLado });
  const dois = R.calcular(JSON.parse(JSON.stringify(QUATRO)), { semente: 'X:1', nomeDoLado });
  assert.deepStrictEqual(um, dois);
  const frases = um.jogadores.map(j => j.previsao);
  const finais = frases.map(f => f.replace(/^.*% de chance de /, ''));
  assert.strictEqual(new Set(finais).size, frases.length);
  for (const f of frases) {
    const m = f.match(/^Quem escolhe “[AB]\d” tem (\d+)% de chance de .+\.$/);
    assert.ok(m, f);
    assert.ok(Number(m[1]) >= 61 && Number(m[1]) <= 97);
  }
  // Duda ficou sozinha nas rodadas 2 e 3: a previsão cita uma delas.
  assert.match(porNome(um).Duda.previsao, /“B2”|“A3”/);
});

test('sem texto da alternativa, a previsão não cita a escolha', () => {
  const j = porNome(R.calcular(QUATRO, { semente: 'X:1' }));
  assert.match(j.Ana.previsao, /^Pelas escolhas de Ana, a chance é alta de .+\.$/);
});

test('partida vazia não quebra', () => {
  assert.deepStrictEqual(R.calcular([], {}), { rodadas: 0, jogadores: [], destaques: [] });
});
