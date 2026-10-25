// Testes do pareamento (node:test, sem dependências).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/pareamento.js');

// Gerador determinístico, para os testes não dependerem da sorte.
function rndFixo(semente) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function base(nBoas = 40, nRuins = 40) {
  const lista = [];
  for (let i = 0; i < nBoas; i++) lista.push({ id: i + 1, tipo: 'boa', rating: 1 + (i % 9) * 0.5, aparicoes: 0 });
  for (let i = 0; i < nRuins; i++) lista.push({ id: 1000 + i, tipo: 'ruim', rating: 1 + (i % 9) * 0.5, aparicoes: 0 });
  const porId = new Map(lista.map(a => [a.id, a]));
  const pool = { boas: lista.filter(a => a.tipo === 'boa'), ruins: lista.filter(a => a.tipo === 'ruim') };
  return { lista, porId, pool };
}

test('cada modo monta opções com a composição certa e sem parte repetida', () => {
  const { porId, pool } = base();
  const rnd = rndFixo(1);
  for (const modo of ['boas', 'ruins', 'misto']) {
    for (let i = 0; i < 200; i++) {
      const par = P.proximoPar(modo, pool, porId, { rnd });
      assert.ok(par, modo);
      for (const o of [par.a, par.b]) {
        assert.strictEqual(o.boa != null, modo !== 'ruins');
        assert.strictEqual(o.ruim != null, modo !== 'boas');
        if (o.boa != null) assert.strictEqual(porId.get(o.boa).tipo, 'boa');
        if (o.ruim != null) assert.strictEqual(porId.get(o.ruim).tipo, 'ruim');
      }
      assert.ok(!P.compartilhaParte(par.a, par.b), 'as duas opções não podem dividir alternativa');
      assert.ok(par.pA > 0 && par.pA < 1);
    }
  }
});

test('pares equilibrados ficam bem mais perto de meio a meio que os aleatórios', () => {
  const { porId, pool } = base();
  const media = (equilibrado) => {
    const rnd = rndFixo(7);
    let soma = 0;
    for (let i = 0; i < 400; i++) soma += Math.abs(P.proximoPar('misto', pool, porId, { rnd, equilibrado }).pA - 0.5);
    return soma / 400;
  };
  const eq = media(true), al = media(false);
  assert.ok(eq < al / 2, `equilibrado ${eq.toFixed(3)} x aleatório ${al.toFixed(3)}`);
});

test('sem alternativas suficientes não monta par', () => {
  const { porId, pool } = base(1, 40);
  assert.strictEqual(P.proximoPar('boas', pool, porId, { rnd: rndFixo(3) }), null);
  assert.strictEqual(P.proximoPar('misto', pool, porId, { rnd: rndFixo(3) }), null);
  assert.ok(P.proximoPar('ruins', pool, porId, { rnd: rndFixo(3) }));
});

test('recentes não voltam enquanto houver outras', () => {
  const { porId, pool } = base(10, 10);
  const recentes = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
  const rnd = rndFixo(11);
  for (let i = 0; i < 100; i++) {
    const a = P.sortearPonderado(pool.boas, rnd, recentes);
    assert.ok(!recentes.has(a.id));
  }
});

test('voto segue a mesma regra do banco (Bradley-Terry, k = 0,15)', () => {
  const { porId } = base();
  const par = { a: { boa: 1, ruim: 1000 }, b: { boa: 2, ruim: 1001 } };
  const antes = [1, 1000, 2, 1001].map(id => porId.get(id).rating);
  const ua = antes[0] - antes[1], ub = antes[2] - antes[3];
  const esperado = 1 / (1 + Math.exp(-(ua - ub) / P.S));
  const pa = P.aplicarVoto(par, 'b', porId);
  assert.ok(Math.abs(pa - esperado) < 1e-12);
  const d = 0.15 * (0 - esperado);
  assert.ok(Math.abs(porId.get(1).rating - (antes[0] + d)) < 1e-12);
  assert.ok(Math.abs(porId.get(1000).rating - (antes[1] - d)) < 1e-12);
  assert.ok(Math.abs(porId.get(2).rating - (antes[2] - d)) < 1e-12);
  assert.ok(Math.abs(porId.get(1001).rating - (antes[3] + d)) < 1e-12);
});
