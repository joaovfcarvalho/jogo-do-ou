// Telas, jogo solo e salas. Os dados vêm do Supabase (js/api.js) e os pares
// são montados por js/pareamento.js.
(function () {
  'use strict';

  var MODOS = { boas: 'Boa ou boa', ruins: 'Ruim ou ruim', misto: 'Boa com ruim' };
  var LEMBRAR = 80;          // ids recentes que não voltam logo
  var INTERVALO_SALA = 1500; // ms entre consultas da sala

  var estado = {
    jogador: ler('jogador', ''),
    familia: ler('familia', false),
    equilibrado: ler('equilibrado', true),
    lista: [],
    porId: new Map(),
    carregado: null,
    recentes: [],
    // solo
    modo: 'boas', par: null, votando: false, votado: false,
    // sala
    rodadas: ler('rodadas', 10),
    sala: null, salaCodigo: null, salaTimer: null, salaOcupada: false,
    salaRodada: -1, salaRevelada: false, salaMeuVoto: null, salaPar: null, salaFim: null
  };

  // ---------------------------------------------------------------- utilitários

  function $(sel) { return document.querySelector(sel); }

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function ler(chave, padrao) {
    try {
      var v = localStorage.getItem('jdo:' + chave);
      return v === null ? padrao : JSON.parse(v);
    } catch (e) { return padrao; }
  }

  function gravar(chave, valor) {
    try { localStorage.setItem('jdo:' + chave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  var avisoTimer = null;
  function avisar(msg, erro) {
    var a = $('#aviso');
    a.textContent = msg;
    a.classList.toggle('erro', !!erro);
    a.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { a.hidden = true; }, erro ? 5000 : 3000);
  }

  function pct(x) { return Math.round(x * 100) + '%'; }
  function numero(n) { return Number(n).toLocaleString('pt-BR'); }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function nota(x) { return x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function trecho(texto) {
    var palavras = texto.split(/\s+/);
    return '“' + (palavras.length <= 5 ? texto : palavras.slice(0, 5).join(' ') + '…') + '”';
  }

  // Como chamar um lado do dilema num texto: pelo começo da alternativa (a boa, no misto).
  // Sem a alternativa na lista (tirada do jogo depois), devolve null.
  function nomeDoLado(par, lado) {
    var o = par[lado];
    var alt = estado.porId.get(o.boa != null ? o.boa : o.ruim);
    return alt ? trecho(alt.texto) : null;
  }

  // O banco guarda as opções em JSON; os ids voltam como texto ou número.
  function parDaSala(opcaoA, opcaoB) {
    function ids(o) {
      return { boa: o.boa != null ? Number(o.boa) : null, ruim: o.ruim != null ? Number(o.ruim) : null };
    }
    return { a: ids(opcaoA), b: ids(opcaoB) };
  }

  // Versão do estado da sala, para ignorar respostas que chegam fora de ordem.
  function versaoSala(st) {
    return st.rodada * 100000 + (st.encerrada ? 20000 : 0) + (st.revelada ? 10000 : 0) + st.votos.length;
  }

  // ---------------------------------------------------------------- dados

  function carregar(forcar) {
    if (estado.carregado && !forcar) return estado.carregado;
    estado.carregado = Api.alternativas().then(function (lista) {
      estado.lista = lista;
      estado.porId = new Map(lista.map(function (a) { return [a.id, a]; }));
    }).catch(function (e) {
      estado.carregado = null;
      throw e;
    });
    return estado.carregado;
  }

  function pool(familia) {
    var boas = [], ruins = [];
    estado.lista.forEach(function (a) {
      if (familia && a.adulto) return;
      (a.tipo === 'boa' ? boas : ruins).push(a);
    });
    return { boas: boas, ruins: ruins };
  }

  function lembrar(par) {
    [par.a.boa, par.a.ruim, par.b.boa, par.b.ruim].forEach(function (id) {
      if (id != null) estado.recentes.push(id);
    });
    if (estado.recentes.length > LEMBRAR) estado.recentes = estado.recentes.slice(-LEMBRAR);
  }

  function atualizarNotas(ratings) {
    Object.keys(ratings || {}).forEach(function (id) {
      var a = estado.porId.get(Number(id));
      if (a) { a.rating = ratings[id]; a.aparicoes += 1; }
    });
  }

  function idsDoPar(par) {
    return [par.a.boa, par.a.ruim, par.b.boa, par.b.ruim].filter(function (id) { return id != null; });
  }

  // ---------------------------------------------------------------- o dilema

  function montarDilema(container, modo, par, aoEscolher) {
    container.dataset.estado = 'votando';
    container.innerHTML = '';
    ['a', 'b'].forEach(function (lado, i) {
      if (i === 1) {
        var ou = el('div', 'ou', 'ou');
        ou.setAttribute('aria-hidden', 'true');
        container.appendChild(ou);
      }
      var opcao = par[lado];
      var botao = el('button', 'opcao opcao-' + lado);
      botao.type = 'button';
      botao.dataset.lado = lado;
      if (modo === 'misto') {
        var ganha = el('span', 'opcao-parte');
        ganha.appendChild(el('span', 'opcao-rotulo', 'Ganha'));
        ganha.appendChild(document.createTextNode(estado.porId.get(opcao.boa).texto));
        var mas = el('span', 'opcao-parte');
        mas.appendChild(el('span', 'opcao-rotulo', 'Mas'));
        mas.appendChild(document.createTextNode(estado.porId.get(opcao.ruim).texto));
        botao.appendChild(ganha);
        botao.appendChild(mas);
      } else {
        var id = opcao.boa != null ? opcao.boa : opcao.ruim;
        botao.appendChild(el('span', 'opcao-parte', estado.porId.get(id).texto));
      }
      botao.appendChild(el('span', 'opcao-pct'));
      botao.appendChild(el('span', 'opcao-nomes'));
      botao.appendChild(el('span', 'marcador', 'Você'));
      botao.addEventListener('click', function () {
        if (container.dataset.estado === 'votando') aoEscolher(lado);
      });
      container.appendChild(botao);
    });
  }

  function marcarEscolha(container, lado) {
    container.querySelectorAll('.opcao').forEach(function (b) {
      b.classList.toggle('escolhida', b.dataset.lado === lado);
    });
  }

  // info: { pctA, escolha, nomesA, nomesB }
  function revelarDilema(container, info) {
    var botoes = container.querySelectorAll('.opcao');
    botoes.forEach(function (b) {
      var lado = b.dataset.lado;
      var p = lado === 'a' ? info.pctA : 1 - info.pctA;
      b.style.setProperty('--pct', p.toFixed(3));
      b.querySelector('.opcao-pct').textContent = pct(p);
      var nomes = lado === 'a' ? info.nomesA : info.nomesB;
      b.querySelector('.opcao-nomes').textContent = nomes && nomes.length ? nomes.join(', ') : '';
      b.setAttribute('aria-disabled', 'true');
    });
    if (info.escolha) marcarEscolha(container, info.escolha);
    // Um quadro depois, para a barra animar a partir de zero.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { container.dataset.estado = 'revelado'; });
    });
  }

  // ---------------------------------------------------------------- telas

  var TELAS = ['inicio', 'jogo', 'sala', 'ranking', 'sugerir'];

  function mostrar(nome) {
    TELAS.forEach(function (t) { $('#tela-' + t).hidden = t !== nome; });
    if (nome !== 'sala') pararSala();
    window.scrollTo(0, 0);
  }

  function rota() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    var partes = h.split('/');
    if (partes[0] === 'jogo' && MODOS[partes[1]]) return abrirJogo(partes[1]);
    if (partes[0] === 'sala' && /^[A-Za-z]{4}$/.test(partes[1] || '')) return abrirSala(partes[1].toUpperCase());
    if (partes[0] === 'ranking') return abrirRanking();
    if (partes[0] === 'sugerir') return mostrar('sugerir');
    abrirInicio();
  }

  function abrirInicio() {
    mostrar('inicio');
    $('#nome').value = estado.jogador;
    $('#familia').checked = estado.familia;
    $('#equilibrado').checked = estado.equilibrado;
    Api.totais().then(function (t) {
      $('#totais').textContent = numero(t.alternativas) + ' alternativas e ' + numero(t.votos) +
        (t.votos === 1 ? ' voto' : ' votos') + ' até agora.';
    }).catch(function () {
      $('#totais').textContent = 'Sem conexão com o banco do jogo agora. Confira a internet.';
    });
  }

  // ---------------------------------------------------------------- solo

  async function abrirJogo(modo) {
    mostrar('jogo');
    estado.modo = modo;
    $('#jogo-modo').textContent = MODOS[modo];
    $('#dilema-solo').innerHTML = '';
    $('#resultado-solo').textContent = 'Carregando as alternativas…';
    try {
      await carregar();
    } catch (e) {
      $('#resultado-solo').textContent = 'Não deu para carregar as alternativas. Confira a internet e abra o jogo de novo.';
      return;
    }
    novoParSolo();
  }

  function novoParSolo() {
    var par = Pareamento.proximoPar(estado.modo, pool(estado.familia), estado.porId, {
      equilibrado: estado.equilibrado, recentes: new Set(estado.recentes)
    });
    var res = $('#resultado-solo');
    $('#proxima').hidden = true;
    if (!par) {
      $('#dilema-solo').innerHTML = '';
      res.textContent = 'Não há alternativas suficientes neste modo. Desligue o modo família ou sugira novas.';
      return;
    }
    estado.par = par;
    estado.votado = false;
    lembrar(par);
    montarDilema($('#dilema-solo'), estado.modo, par, escolherSolo);
    res.textContent = '';
  }

  async function escolherSolo(lado) {
    if (estado.votando || estado.votado) return;
    estado.votando = true;
    var par = estado.par;
    marcarEscolha($('#dilema-solo'), lado);
    try {
      var r = await Api.votar(estado.modo, par, lado, estado.jogador || null);
      estado.votado = true;
      atualizarNotas(r.ratings);
      revelarDilema($('#dilema-solo'), { pctA: r.p_a, escolha: lado });
      escreverResultadoSolo(par, lado, r);
      $('#proxima').hidden = false;
      $('#proxima').focus({ preventScroll: true });
    } catch (e) {
      marcarEscolha($('#dilema-solo'), null);
      avisar('O voto não foi registrado. Confira a internet e toque de novo.', true);
    } finally {
      estado.votando = false;
    }
  }

  function escreverResultadoSolo(par, lado, r) {
    var res = $('#resultado-solo');
    res.innerHTML = '';
    var p = lado === 'a' ? r.p_a : 1 - r.p_a;
    var frase;
    if (Math.abs(r.p_a - 0.5) < 0.07) frase = 'Dilema dos bons: as notas previam quase meio a meio.';
    else if (p < 0.3) frase = 'Contra a maré: pelas notas, só ' + pct(p) + ' iriam nessa.';
    else if (p > 0.7) frase = 'Com a maioria: pelas notas, ' + pct(p) + ' iriam nessa.';
    else frase = 'Pelas notas, ' + pct(p) + ' iriam nessa.';
    res.appendChild(el('p', null, frase));

    var h = r.historico || { total: 0, a: 0 };
    if (h.total > 0) {
      var iguais = (lado === 'a' ? h.a : h.total - h.a) + 1;
      res.appendChild(el('p', null, 'Neste mesmo par, ' + iguais + ' de ' + (h.total + 1) +
        ' pessoas escolheram igual a você.'));
    }

    var linha = el('p');
    linha.appendChild(document.createTextNode('Alguma sem graça? '));
    idsDoPar(par).forEach(function (id) {
      var alt = estado.porId.get(id);
      var b = el('button', 'sinalizar', trecho(alt.texto));
      b.type = 'button';
      b.title = alt.texto;
      b.addEventListener('click', function () {
        b.disabled = true;
        Api.sinalizar(id).then(function () {
          b.textContent = 'anotado';
        }).catch(function () {
          b.disabled = false;
          avisar('Não deu para anotar agora. Tente de novo.', true);
        });
      });
      linha.appendChild(b);
    });
    res.appendChild(linha);
  }

  // ---------------------------------------------------------------- sala

  function precisaNome() {
    if (estado.jogador) return false;
    location.hash = '#inicio';
    avisar('Antes, escreva seu nome no jogo.', true);
    setTimeout(function () { $('#nome').focus(); }, 50);
    return true;
  }

  async function criarSala() {
    salvarNome();
    if (precisaNome()) return;
    var botao = $('#criar-sala');
    botao.disabled = true;
    try {
      var st = await Api.criarSala($('#modo-sala').value, estado.familia, estado.jogador);
      location.hash = '#sala/' + st.codigo;
    } catch (e) {
      avisar('Não deu para criar a sala. Confira a internet e tente de novo.', true);
    } finally {
      botao.disabled = false;
    }
  }

  async function abrirSala(codigo) {
    if (precisaNome()) { estado.salaPendente = codigo; return; }
    mostrar('sala');
    estado.salaRodada = -1;
    estado.salaRevelada = false;
    estado.salaMeuVoto = null;
    estado.salaVersao = -1;
    estado.salaFim = null;
    $('#sala-total').value = String(estado.rodadas);
    $('#sala-codigo').textContent = 'Sala ' + codigo;
    $('#dilema-sala').innerHTML = '';
    $('#resultado-sala').textContent = 'Entrando na sala…';
    try {
      await carregar();
      var st = await Api.entrarSala(codigo, estado.jogador);
      if (!st) {
        avisar('Sala ' + codigo + ' não encontrada. Confira o código.', true);
        location.hash = '#inicio';
        return;
      }
      estado.salaCodigo = st.codigo;
      await aplicarSala(st);
      pararSala();
      estado.salaTimer = setInterval(consultarSala, INTERVALO_SALA);
    } catch (e) {
      $('#resultado-sala').textContent = 'Não deu para entrar na sala. Confira a internet e abra o link de novo.';
    }
  }

  function pararSala() {
    if (estado.salaTimer) clearInterval(estado.salaTimer);
    estado.salaTimer = null;
  }

  async function consultarSala() {
    if (document.hidden || estado.salaOcupada || !estado.salaCodigo) return;
    estado.salaOcupada = true;
    try {
      var st = await Api.estadoSala(estado.salaCodigo, estado.jogador);
      if (st) await aplicarSala(st);
    } catch (e) {
      /* tenta de novo na próxima volta */
    } finally {
      estado.salaOcupada = false;
    }
  }

  async function aplicarSala(st) {
    if (versaoSala(st) < estado.salaVersao) return;
    estado.salaVersao = versaoSala(st);
    estado.sala = st;
    var votaram = new Set(st.votos.map(function (v) { return v.jogador; }));
    estado.salaJaVotei = votaram.has(estado.jogador);

    var lista = $('#sala-jogadores');
    lista.innerHTML = '';
    st.jogadores.forEach(function (j) {
      var li = el('li', null, j.nome);
      if (votaram.has(j.nome)) li.classList.add('votou');
      if (!j.ativo) li.classList.add('ausente');
      lista.appendChild(li);
    });

    var espera = st.rodada === 0;
    var fim = !espera && !!st.encerrada;
    var n = st.rodada - st.inicio_partida + 1;
    var ultima = n >= st.total_rodadas;
    $('#sala-codigo').textContent = 'Sala ' + st.codigo + (espera || fim ? '' : ' · ' + n + ' de ' + st.total_rodadas);
    $('#sala-espera').hidden = !espera;
    $('#espera-codigo').textContent = st.codigo;
    $('#sala-fim').hidden = !fim;
    $('#dilema-sala').hidden = espera || fim;
    $('#sala-total-campo').hidden = !(espera || fim);
    $('#sala-comecar').hidden = !espera;
    $('#sala-de-novo').hidden = !fim;
    if (espera || fim) {
      ['#sala-revelar', '#sala-proxima', '#sala-ver', '#sala-terminar'].forEach(function (s) { $(s).hidden = true; });
      $('#resultado-sala').textContent = espera ? 'Jogo: ' + MODOS[st.modo] + (st.familia ? ', modo família.' : '.') : '';
      if (fim) await mostrarFim(st);
      return;
    }

    if (st.rodada !== estado.salaRodada) {
      var par = parDaSala(st.opcao_a, st.opcao_b);
      // Alguém pode ter sugerido alternativas depois que esta tela carregou.
      if (idsDoPar(par).some(function (id) { return !estado.porId.has(id); })) await carregar(true);
      estado.salaRodada = st.rodada;
      estado.salaRevelada = false;
      estado.salaMeuVoto = null;
      estado.salaPar = par;
      lembrar(par);
      montarDilema($('#dilema-sala'), st.modo, par, escolherSala);
    }

    if (st.revelada && !estado.salaRevelada) {
      estado.salaRevelada = true;
      var nomesA = st.votos.filter(function (v) { return v.escolha === 'a'; }).map(function (v) { return v.jogador; });
      var nomesB = st.votos.filter(function (v) { return v.escolha === 'b'; }).map(function (v) { return v.jogador; });
      var total = nomesA.length + nomesB.length;
      var meu = st.votos.filter(function (v) { return v.jogador === estado.jogador; })[0];
      revelarDilema($('#dilema-sala'), {
        pctA: total ? nomesA.length / total : 0.5,
        escolha: estado.salaMeuVoto || (meu && meu.escolha), nomesA: nomesA, nomesB: nomesB
      });
      var par = estado.salaPar;
      var res = $('#resultado-sala');
      res.innerHTML = '';
      res.appendChild(el('p', null, total === 0 ? 'Ninguém votou nesta rodada.'
        : nomesA.length === nomesB.length ? 'Empate na mesa, ' + nomesA.length + ' a ' + nomesB.length + '.'
        : 'A mesa foi de ' + nomeDoLado(par, nomesA.length > nomesB.length ? 'a' : 'b') + ', ' +
          Math.max(nomesA.length, nomesB.length) + ' a ' + Math.min(nomesA.length, nomesB.length) + '.'));
      if (st.p_a != null) {
        var favorito = st.p_a >= 0.5 ? 'a' : 'b';
        res.appendChild(el('p', null, 'Pelas notas, o jogo esperava ' +
          pct(favorito === 'a' ? st.p_a : 1 - st.p_a) + ' em ' + nomeDoLado(par, favorito) + '.'));
      }
    } else if (!st.revelada) {
      var ativos = st.jogadores.filter(function (j) { return j.ativo; }).length;
      $('#resultado-sala').textContent = 'Votaram ' + st.votos.length + ' de ' + Math.max(ativos, st.votos.length) + '.';
    }

    $('#sala-revelar').hidden = st.revelada || st.votos.length === 0;
    $('#sala-proxima').hidden = !st.revelada || ultima;
    $('#sala-ver').hidden = !st.revelada || !ultima;
    $('#sala-terminar').hidden = !st.revelada || ultima;
  }

  // ---------------------------------------------------------------- fim da partida

  async function mostrarFim(st) {
    var chave = st.codigo + ':' + st.inicio_partida;
    if (estado.salaFim === chave) return;
    estado.salaFim = chave;
    var caixa = $('#fim-conteudo');
    caixa.textContent = 'Somando os votos…';
    try {
      var rodadas = await Api.resultadoSala(st.codigo);
      var faltam = rodadas.some(function (r) {
        return idsDoPar(parDaSala(r.opcao_a, r.opcao_b)).some(function (id) { return !estado.porId.has(id); });
      });
      if (faltam) await carregar(true);
      desenharFim(caixa, rodadas, chave);
    } catch (e) {
      estado.salaFim = null; // tenta de novo na próxima consulta
      caixa.textContent = 'Não deu para somar os votos agora. Tentando de novo…';
    }
  }

  function desenharFim(caixa, rodadas, semente) {
    var res = Resultado.calcular(rodadas, {
      semente: semente,
      nomeDoLado: function (r, lado) { return nomeDoLado(parDaSala(r.opcao_a, r.opcao_b), lado); }
    });
    caixa.innerHTML = '';
    if (!res.jogadores.length) {
      caixa.appendChild(el('p', 'nota', 'Ninguém votou nesta partida.'));
      return;
    }
    caixa.appendChild(el('p', 'nota', plural(res.rodadas, 'rodada', 'rodadas') + ', ' +
      plural(res.jogadores.length, 'pessoa', 'pessoas') + '.'));

    // O seu cartão vem primeiro; depois os destaques e o resto da galera.
    var meus = res.jogadores.filter(function (j) { return j.nome === estado.jogador; });
    var outros = res.jogadores.filter(function (j) { return j.nome !== estado.jogador; });
    if (meus.length) caixa.appendChild(cartao(meus[0], true));

    if (res.destaques.length) {
      caixa.appendChild(el('h3', 'subtitulo', 'Destaques da mesa'));
      var ul = el('ul', 'destaques');
      res.destaques.forEach(function (d) {
        var li = el('li');
        li.appendChild(el('strong', null, d.titulo));
        li.appendChild(document.createTextNode(d.texto));
        ul.appendChild(li);
      });
      caixa.appendChild(ul);
    }

    if (outros.length) {
      caixa.appendChild(el('h3', 'subtitulo', meus.length ? 'A galera' : 'Perfis'));
      var grade = el('div', 'perfis');
      outros.forEach(function (j) { grade.appendChild(cartao(j, false)); });
      caixa.appendChild(grade);
    }
  }

  function cartao(j, meu) {
    var card = el('article', 'perfil' + (meu ? ' voce' : ''));
    var nome = el('p', 'perfil-nome', j.nome);
    if (meu) nome.appendChild(el('span', 'perfil-voce', 'Você'));
    card.appendChild(nome);
    card.appendChild(el('p', 'perfil-titulo', j.perfil.titulo));
    card.appendChild(el('p', 'perfil-frase', j.perfil.frase));
    var numeros = plural(j.votos, 'voto', 'votos');
    if (j.maioria || j.minoria) numeros += ': ' + j.maioria + ' com a maioria, ' + j.minoria + ' na minoria';
    card.appendChild(el('p', 'perfil-numeros', numeros + '.'));
    if (j.parecido && j.parecido.iguais * 2 > j.parecido.juntos) {
      card.appendChild(el('p', 'perfil-numeros', 'Vota igual a ' + j.parecido.nome + ': ' +
        j.parecido.iguais + ' de ' + j.parecido.juntos + ' rodadas.'));
    }
    var prev = el('p', 'perfil-previsao');
    prev.appendChild(el('span', 'perfil-rotulo', 'Previsão'));
    prev.appendChild(document.createTextNode(j.previsao));
    card.appendChild(prev);
    return card;
  }

  async function escolherSala(lado) {
    var st = estado.sala;
    if (!st || st.revelada || estado.salaMeuVoto || estado.salaJaVotei) return;
    estado.salaMeuVoto = lado;
    marcarEscolha($('#dilema-sala'), lado);
    try {
      var novo = await Api.votarSala(st.codigo, estado.salaRodada, estado.jogador, lado);
      if (novo) await aplicarSala(novo);
    } catch (e) {
      estado.salaMeuVoto = null;
      marcarEscolha($('#dilema-sala'), null);
      avisar('O voto não foi registrado. Toque de novo.', true);
    }
  }

  // Sorteia o próximo par e pede ao banco para avançar (próxima rodada ou partida nova).
  async function avancar(pedir, erro) {
    var st = estado.sala;
    if (!st) return;
    var par = Pareamento.proximoPar(st.modo, pool(st.familia), estado.porId, {
      equilibrado: estado.equilibrado, recentes: new Set(estado.recentes)
    });
    if (!par) { avisar('Não há alternativas suficientes neste modo.', true); return; }
    var botoes = document.querySelectorAll('#tela-sala .acoes-jogo .botao');
    botoes.forEach(function (b) { b.disabled = true; });
    try {
      var novo = await pedir(st, par);
      if (novo) await aplicarSala(novo);
    } catch (e) {
      avisar(erro, true);
    } finally {
      botoes.forEach(function (b) { b.disabled = false; });
    }
  }

  function proximaRodada() {
    return avancar(function (st, par) { return Api.novaRodada(st.codigo, st.rodada, par.a, par.b); },
      'Não deu para puxar a próxima. Tente de novo.');
  }

  function novaPartida() {
    var total = Number($('#sala-total').value);
    estado.rodadas = total;
    gravar('rodadas', total);
    return avancar(function (st, par) { return Api.novaPartida(st.codigo, st.rodada, total, par.a, par.b); },
      'Não deu para começar a partida. Tente de novo.');
  }

  async function encerrarPartida() {
    var st = estado.sala;
    if (!st) return;
    try {
      var novo = await Api.encerrar(st.codigo, st.rodada);
      if (novo) await aplicarSala(novo);
    } catch (e) {
      avisar('Não deu para encerrar. Tente de novo.', true);
    }
  }

  async function revelarAgora() {
    var st = estado.sala;
    if (!st) return;
    try {
      var novo = await Api.revelar(st.codigo, st.rodada);
      if (novo) await aplicarSala(novo);
    } catch (e) {
      avisar('Não deu para revelar. Tente de novo.', true);
    }
  }

  // Sai de verdade: o nome some da lista de todo mundo. Sem conexão, fica como ausente.
  function sairSala() {
    var codigo = estado.salaCodigo;
    estado.salaCodigo = null;
    pararSala();
    if (codigo && estado.jogador) Api.sairSala(codigo, estado.jogador).catch(function () { /* fica como ausente */ });
    location.hash = '#inicio';
  }

  async function convidar() {
    var link = location.origin + location.pathname + '#sala/' + estado.salaCodigo;
    if (navigator.share) {
      try { await navigator.share({ title: 'Jogo do Ou', text: 'Entra na sala ' + estado.salaCodigo, url: link }); return; }
      catch (e) { /* cancelou o compartilhamento: cai para copiar */ }
    }
    try {
      await navigator.clipboard.writeText(link);
      avisar('Link copiado. Cole no grupo da galera.');
    } catch (e) {
      avisar('Copie o link: ' + link);
    }
  }

  // ---------------------------------------------------------------- ranking e sugestões

  async function abrirRanking() {
    mostrar('ranking');
    var boas = $('#ranking-boas'), ruins = $('#ranking-ruins');
    boas.innerHTML = ''; ruins.innerHTML = '';
    try {
      await carregar(true);
    } catch (e) {
      boas.appendChild(el('li', null, 'Não deu para carregar o ranking. Confira a internet.'));
      return;
    }
    function preencher(ol, tipo) {
      estado.lista
        .filter(function (a) { return a.tipo === tipo && !(estado.familia && a.adulto); })
        .sort(function (x, y) { return y.rating - x.rating; })
        .slice(0, 15)
        .forEach(function (a) {
          var li = el('li');
          li.appendChild(document.createTextNode(a.texto + ' '));
          li.appendChild(el('span', 'nota-alt', 'nota ' + nota(a.rating)));
          if (a.aparicoes) li.appendChild(document.createTextNode(', em ' + a.aparicoes + (a.aparicoes === 1 ? ' voto' : ' votos')));
          ol.appendChild(li);
        });
    }
    preencher(boas, 'boa');
    preencher(ruins, 'ruim');
  }

  async function enviarSugestao(ev) {
    ev.preventDefault();
    var form = ev.target;
    var texto = $('#texto-sugestao').value.trim();
    if (texto.length < 3) { avisar('Escreva a alternativa antes de enviar.', true); return; }
    var tipo = form.querySelector('input[name="tipo"]:checked').value;
    var botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      var nova = await Api.sugerir(tipo, texto, $('#adulto-sugestao').checked, estado.jogador || null);
      if (estado.carregado) {
        estado.lista.push(nova);
        estado.porId.set(nova.id, nova);
      }
      form.reset();
      avisar('Alternativa enviada. Já pode aparecer no jogo.');
    } catch (e) {
      avisar(/duplicate|unique/i.test(e.message) ? 'Essa alternativa já existe no jogo.' : 'Não deu para enviar. Tente de novo.', true);
    } finally {
      botao.disabled = false;
    }
  }

  // ---------------------------------------------------------------- ligações

  function salvarNome() {
    estado.jogador = $('#nome').value.trim().slice(0, 20);
    gravar('jogador', estado.jogador);
  }

  document.querySelectorAll('.modo').forEach(function (b) {
    b.addEventListener('click', function () {
      salvarNome();
      location.hash = '#jogo/' + b.dataset.modo;
    });
  });
  $('#nome').addEventListener('change', function () {
    salvarNome();
    if (estado.jogador && estado.salaPendente) {
      var cod = estado.salaPendente;
      estado.salaPendente = null;
      location.hash = '#sala/' + cod;
    }
  });
  $('#familia').addEventListener('change', function (e) { estado.familia = e.target.checked; gravar('familia', estado.familia); });
  $('#equilibrado').addEventListener('change', function (e) { estado.equilibrado = e.target.checked; gravar('equilibrado', estado.equilibrado); });
  $('#criar-sala').addEventListener('click', criarSala);
  $('#form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    salvarNome();
    var cod = $('#codigo').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(cod)) { avisar('O código da sala tem 4 letras.', true); return; }
    location.hash = '#sala/' + cod;
  });
  $('#proxima').addEventListener('click', novoParSolo);
  $('#sair-sala').addEventListener('click', sairSala);
  $('#convidar').addEventListener('click', convidar);
  $('#sala-comecar').addEventListener('click', novaPartida);
  $('#sala-de-novo').addEventListener('click', novaPartida);
  $('#sala-proxima').addEventListener('click', proximaRodada);
  $('#sala-ver').addEventListener('click', encerrarPartida);
  $('#sala-terminar').addEventListener('click', encerrarPartida);
  $('#sala-revelar').addEventListener('click', revelarAgora);
  $('#form-sugerir').addEventListener('submit', enviarSugestao);

  // Teclado no jogo solo: A/B ou setas para escolher, Enter para a próxima.
  document.addEventListener('keydown', function (ev) {
    if ($('#tela-jogo').hidden || /input|textarea|select/i.test(ev.target.tagName)) return;
    var dilema = $('#dilema-solo');
    if (dilema.dataset.estado === 'votando') {
      if (ev.key === 'a' || ev.key === 'A' || ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') escolherSolo('a');
      if (ev.key === 'b' || ev.key === 'B' || ev.key === 'ArrowRight' || ev.key === 'ArrowDown') escolherSolo('b');
    } else if (ev.key === 'Enter' && !$('#proxima').hidden && ev.target === document.body) {
      novoParSolo();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && estado.salaTimer) consultarSala();
  });

  // Link antigo no formato ?sala=ABCD vira #sala/ABCD.
  var q = new URLSearchParams(location.search).get('sala');
  if (q && !location.hash) location.hash = '#sala/' + q.toUpperCase();

  window.addEventListener('hashchange', rota);
  rota();
})();
