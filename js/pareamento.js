// Montagem dos dilemas: sorteia a opção A e procura uma B de peso parecido.
// Funções puras (sem DOM), usadas pelo navegador e pelos testes em Node.
(function (raiz) {
  'use strict';

  // Mesma temperatura usada pelo banco em `votar` (P(A) = 1 / (1 + e^(-(Ua - Ub) / S))).
  var S = 0.8;
  var CANDIDATOS = 60;

  function utilidade(opcao, porId) {
    var boa = opcao.boa != null ? porId.get(opcao.boa).rating : 0;
    var ruim = opcao.ruim != null ? porId.get(opcao.ruim).rating : 0;
    return boa - ruim;
  }

  function chanceDeA(ua, ub) {
    return 1 / (1 + Math.exp(-(ua - ub) / S));
  }

  // Quem apareceu menos tem mais chance de sair, para os votos se espalharem.
  function sortearPonderado(lista, rnd, evitar) {
    var pool = evitar ? lista.filter(function (x) { return !evitar.has(x.id); }) : lista;
    if (pool.length === 0) pool = lista;
    var pesos = pool.map(function (x) { return 1 / Math.sqrt(1 + (x.aparicoes || 0)); });
    var total = pesos.reduce(function (s, p) { return s + p; }, 0);
    var alvo = rnd() * total;
    for (var i = 0; i < pool.length; i++) {
      alvo -= pesos[i];
      if (alvo <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // Sorteio uniforme; tenta algumas vezes fugir dos ids recentes.
  function sortearSimples(lista, rnd, evitar) {
    for (var t = 0; t < 6; t++) {
      var x = lista[Math.floor(rnd() * lista.length)];
      if (!evitar || !evitar.has(x.id)) return x;
    }
    return lista[Math.floor(rnd() * lista.length)];
  }

  function montarOpcao(modo, pool, rnd, evitar, ponderado) {
    var pegar = ponderado ? function (l) { return sortearPonderado(l, rnd, evitar); }
                          : function (l) { return sortearSimples(l, rnd, evitar); };
    return {
      boa: modo === 'ruins' ? null : pegar(pool.boas).id,
      ruim: modo === 'boas' ? null : pegar(pool.ruins).id
    };
  }

  function compartilhaParte(a, b) {
    return (a.boa != null && a.boa === b.boa) || (a.ruim != null && a.ruim === b.ruim);
  }

  function poolSuficiente(modo, pool) {
    if (modo === 'boas') return pool.boas.length >= 2;
    if (modo === 'ruins') return pool.ruins.length >= 2;
    return pool.boas.length >= 2 && pool.ruins.length >= 2;
  }

  // pool: { boas: [...], ruins: [...] } já filtrado (ativas, modo família).
  // opcoes: { equilibrado, recentes (Set de ids), rnd }.
  function proximoPar(modo, pool, porId, opcoes) {
    opcoes = opcoes || {};
    var rnd = opcoes.rnd || Math.random;
    var recentes = opcoes.recentes || new Set();
    if (!poolSuficiente(modo, pool)) return null;

    var a = montarOpcao(modo, pool, rnd, recentes, true);
    var ua = utilidade(a, porId);
    var b = null;

    if (opcoes.equilibrado === false) {
      for (var t = 0; t < 50 && (b === null || compartilhaParte(a, b)); t++) {
        b = montarOpcao(modo, pool, rnd, null, false);
      }
    } else {
      var melhor = Infinity;
      for (var i = 0; i < CANDIDATOS; i++) {
        var c = montarOpcao(modo, pool, rnd, recentes, false);
        if (compartilhaParte(a, c)) continue;
        // Um pouco de ruído para o mesmo par não voltar sempre.
        var custo = Math.abs(utilidade(c, porId) - ua) + rnd() * 0.25;
        if (custo < melhor) { melhor = custo; b = c; }
      }
    }
    if (b === null || compartilhaParte(a, b)) return null;

    // Sorteia o lado, para a âncora não ficar sempre em cima.
    if (rnd() < 0.5) { var tmp = a; a = b; b = tmp; }
    return { a: a, b: b, pA: chanceDeA(utilidade(a, porId), utilidade(b, porId)) };
  }

  // Mesma regra de atualização do banco, para a tela refletir o voto sem recarregar tudo.
  function aplicarVoto(par, escolha, porId, k) {
    k = k || 0.15;
    var pa = chanceDeA(utilidade(par.a, porId), utilidade(par.b, porId));
    var d = k * ((escolha === 'a' ? 1 : 0) - pa);
    function mexer(id, delta) {
      if (id == null) return;
      var alt = porId.get(id);
      alt.rating = Math.min(5.5, Math.max(0.5, alt.rating + delta));
    }
    mexer(par.a.boa, d); mexer(par.a.ruim, -d);
    mexer(par.b.boa, -d); mexer(par.b.ruim, d);
    return pa;
  }

  var api = {
    S: S,
    utilidade: utilidade,
    chanceDeA: chanceDeA,
    sortearPonderado: sortearPonderado,
    proximoPar: proximoPar,
    aplicarVoto: aplicarVoto,
    compartilhaParte: compartilhaParte
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Pareamento = api;
})(this);
