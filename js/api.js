// Conversa com o Supabase pela API REST (PostgREST), sem biblioteca.
(function () {
  'use strict';

  var url = window.CONFIG.supabaseUrl;
  var cabecalhos = {
    apikey: window.CONFIG.supabaseChave,
    'Content-Type': 'application/json'
  };

  async function pedir(caminho, opcoes) {
    var resp = await fetch(url + caminho, Object.assign({ headers: cabecalhos }, opcoes));
    if (!resp.ok) {
      var corpo = await resp.text();
      var msg = corpo;
      try { msg = JSON.parse(corpo).message || corpo; } catch (e) { /* texto puro */ }
      throw new Error(msg || ('HTTP ' + resp.status));
    }
    var texto = await resp.text();
    return texto ? JSON.parse(texto) : null;
  }

  function rpc(nome, args) {
    return pedir('/rest/v1/rpc/' + nome, { method: 'POST', body: JSON.stringify(args || {}) });
  }

  // O PostgREST devolve no máximo 1000 linhas por vez; pagina até acabar.
  async function alternativas() {
    var campos = 'id,tipo,texto,rating,aparicoes,escolhas,adulto,fonte';
    var todas = [];
    for (var inicio = 0; ; inicio += 1000) {
      var lote = await pedir('/rest/v1/alternativas?select=' + campos +
        '&order=id&offset=' + inicio + '&limit=1000');
      todas = todas.concat(lote);
      if (lote.length < 1000) return todas;
    }
  }

  window.Api = {
    alternativas: alternativas,
    totais: function () { return rpc('ping'); },
    votar: function (modo, par, escolha, jogador) {
      return rpc('votar', {
        p_modo: modo, p_a_boa: par.a.boa, p_a_ruim: par.a.ruim,
        p_b_boa: par.b.boa, p_b_ruim: par.b.ruim, p_escolha: escolha, p_jogador: jogador
      });
    },
    sinalizar: function (id) { return rpc('sinalizar', { p_id: id }); },
    sugerir: function (tipo, texto, adulto, autor) {
      return rpc('sugerir', { p_tipo: tipo, p_texto: texto, p_adulto: adulto, p_autor: autor });
    },
    criarSala: function (modo, familia, jogador) {
      return rpc('criar_sala', { p_modo: modo, p_familia: familia, p_jogador: jogador });
    },
    entrarSala: function (codigo, jogador) {
      return rpc('entrar_sala', { p_codigo: codigo, p_jogador: jogador });
    },
    sairSala: function (codigo, jogador) {
      return rpc('sair_sala', { p_codigo: codigo, p_jogador: jogador });
    },
    estadoSala: function (codigo, jogador) {
      return rpc('estado_sala', { p_codigo: codigo, p_jogador: jogador });
    },
    novaRodada: function (codigo, rodada, a, b) {
      return rpc('nova_rodada', { p_codigo: codigo, p_rodada: rodada, p_a: a, p_b: b });
    },
    votarSala: function (codigo, rodada, jogador, escolha) {
      return rpc('votar_sala', { p_codigo: codigo, p_rodada: rodada, p_jogador: jogador, p_escolha: escolha });
    },
    revelar: function (codigo, rodada) {
      return rpc('revelar', { p_codigo: codigo, p_rodada: rodada });
    },
    novaPartida: function (codigo, rodada, total, a, b) {
      return rpc('nova_partida', { p_codigo: codigo, p_rodada: rodada, p_total: total, p_a: a, p_b: b });
    },
    encerrar: function (codigo, rodada) {
      return rpc('encerrar', { p_codigo: codigo, p_rodada: rodada });
    },
    resultadoSala: function (codigo) {
      return rpc('resultado_sala', { p_codigo: codigo });
    }
  };
})();
