// Resultado da partida na sala: os números de cada pessoa, um perfil, uma previsão
// de horóscopo e os destaques da mesa. Funções puras (sem DOM), usadas pelo
// navegador e pelos testes em Node. Todo celular da sala chega ao mesmo resultado.
(function (raiz) {
  'use strict';

  var MIN_VOTOS = 3;   // com menos votos que isso, não dá para traçar perfil
  var MIN_JUNTOS = 3;  // rodadas em comum para comparar duas pessoas

  // Previsões no estilo teste de revista com astrologia (ideia do Guilherme).
  // Completam a frase "Quem escolhe X tem 87% de chance de ...".
  var PREVISOES = [
    'ter passado a infância na casa da avó',
    'responder áudio de três minutos com "kkkk"',
    'guardar feijão em pote de sorvete',
    'ter um grupo de WhatsApp sem mais ninguém, só para mandar coisa para si',
    'chorar em comercial de margarina',
    'dizer "tô chegando" ainda no banho',
    'ter uma planilha para organizar a própria vida',
    'pedir sempre o mesmo prato no restaurante',
    'já ter discutido com o GPS',
    'pôr o despertador para 6h, 6h05, 6h10 e 6h15',
    'fingir que leu os termos de uso',
    'comer a borda da pizza primeiro',
    'ainda ter o carregador de um Nokia guardado',
    'rir de piada sem ter entendido',
    'abrir a geladeira cinco vezes esperando aparecer comida nova',
    'falar com cachorro na rua com voz de bebê',
    'ter uma gaveta só de sacolinhas',
    'chegar cedo na festa e acabar ajudando a encher balão',
    'mandar bom-dia com foto de flor no grupo da família',
    'ler o final do livro primeiro',
    'ter medo de pombo',
    'nunca ter terminado uma série',
    'saber o nome do porteiro, do cachorro do porteiro e da sogra do porteiro',
    'já ter acenado de volta para quem acenava para outra pessoa',
    'usar "kkkkk" como ponto final',
    'comprar coisa inútil às duas da manhã',
    'levar violão para o churrasco',
    'dormir no cinema e jurar que viu o filme',
    'ter um apelido que só a família conhece',
    'fazer lista de compras e esquecer a lista em casa',
    'ainda usar o mesmo e-mail de 2008',
    'sair da festa sem se despedir de ninguém',
    'assistir vídeo de receita que nunca vai fazer',
    'pedir "só um pedacinho" da comida dos outros',
    'conferir três vezes se trancou a porta',
    'ter mais de mil e-mails não lidos',
    'falar "vamos marcar" e nunca marcar',
    'saber de cor o jingle de uma propaganda dos anos 90',
    'dar nome para as plantas de casa',
    'responder "você também" quando o garçom diz "bom apetite"'
  ];

  // FNV-1a: o mesmo texto dá o mesmo número em todos os celulares.
  function hash(texto) {
    var h = 2166136261;
    for (var i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function ordemNome(x, y) {
    return x.localeCompare(y, 'pt-BR', { sensitivity: 'base' }) || (x < y ? -1 : x > y ? 1 : 0);
  }

  function juntar(nomes) {
    return nomes.length === 1 ? nomes[0] : nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  // Lê uma rodada: quem foi de cada lado, a ordem dos votos e se houve maioria.
  function lerRodada(r, i) {
    var lados = { a: [], b: [] };
    r.votos.forEach(function (v) { lados[v.escolha].push(v.jogador); });
    var total = r.votos.length;
    return {
      numero: i + 1, fonte: r, lados: lados, total: total,
      unanime: total >= 2 && (lados.a.length === 0 || lados.b.length === 0),
      // Maioria e minoria só fazem sentido com três votos ou mais.
      rachou: total >= 3 && lados.a.length > 0 && lados.b.length > 0 && lados.a.length !== lados.b.length
    };
  }

  function contar(lidas) {
    var porNome = new Map();
    var pares = new Map();
    lidas.forEach(function (l) {
      var votos = l.fonte.votos;
      votos.forEach(function (v, k) {
        if (!porNome.has(v.jogador)) {
          porNome.set(v.jogador, {
            nome: v.jogador, votos: 0, maioria: 0, minoria: 0, rachadas: 0, sozinho: 0,
            primeiro: 0, ultimo: 0, comOutros: 0, escolhas: [], minorias: [], todas: []
          });
        }
        var j = porNome.get(v.jogador);
        var meu = l.lados[v.escolha].length;
        var outro = l.total - meu;
        j.votos += 1;
        j.escolhas.push(l.numero + v.escolha);
        j.todas.push({ fonte: l.fonte, lado: v.escolha });
        if (l.total >= 3 && meu > outro) j.maioria += 1;
        if (l.total >= 3 && meu < outro) {
          j.minoria += 1;
          j.minorias.push({ fonte: l.fonte, lado: v.escolha });
          if (meu === 1) j.sozinho += 1;
        }
        if (l.rachou) j.rachadas += 1;
        if (l.total >= 2) {
          j.comOutros += 1;
          if (k === 0) j.primeiro += 1;
          if (k === votos.length - 1) j.ultimo += 1;
        }
        for (var m = 0; m < k; m++) {
          var x = votos[m].jogador, y = v.jogador;
          var chave = ordemNome(x, y) <= 0 ? x + '\u0000' + y : y + '\u0000' + x;
          if (!pares.has(chave)) pares.set(chave, { x: chave.split('\u0000')[0], y: chave.split('\u0000')[1], juntos: 0, iguais: 0 });
          var p = pares.get(chave);
          p.juntos += 1;
          if (votos[m].escolha === v.escolha) p.iguais += 1;
        }
      });
    });
    return { jogadores: Array.from(porNome.values()).sort(function (a, b) { return ordemNome(a.nome, b.nome); }),
             pares: Array.from(pares.values()) };
  }

  // Pares com rodadas suficientes, do mais parecido para o menos parecido.
  function paresValidos(pares) {
    return pares.filter(function (p) { return p.juntos >= MIN_JUNTOS; }).sort(function (p, q) {
      return q.iguais / q.juntos - p.iguais / p.juntos || q.juntos - p.juntos ||
        ordemNome(p.x, q.x) || ordemNome(p.y, q.y);
    });
  }

  function maisParecido(nome, validos) {
    var p = validos.filter(function (q) { return q.x === nome || q.y === nome; })[0];
    return p ? { nome: p.x === nome ? p.y : p.x, iguais: p.iguais, juntos: p.juntos } : null;
  }

  function perfil(j) {
    var comMaioria = j.rachadas - j.minoria;
    var par = j.parecido;
    if (j.votos < MIN_VOTOS) {
      return { titulo: 'Turista', frase: 'Votou em só ' + plural(j.votos, 'rodada', 'rodadas') +
        '. Pouco para traçar um perfil, mas a previsão aqui embaixo não falha.' };
    }
    if (j.sozinho >= 2) {
      return { titulo: 'Lobo solitário', frase: 'Foi a única pessoa de um lado em ' + j.sozinho + ' rodadas.' };
    }
    if (j.rachadas >= 2 && j.minoria / j.rachadas >= 0.5) {
      return { titulo: 'Do contra', frase: 'Ficou na minoria em ' + j.minoria + ' das ' + j.rachadas +
        ' rodadas em que a mesa rachou.' };
    }
    if (j.rachadas >= 3 && j.minoria === 0) {
      return { titulo: 'Maria vai com as outras', frase: 'Ficou com a maioria em todas as ' + j.rachadas +
        ' rodadas em que a mesa rachou.' };
    }
    if (j.rachadas >= 3 && j.minoria / j.rachadas <= 0.25) {
      return { titulo: 'Termômetro da mesa', frase: 'Quer saber o que a galera vai escolher? Pergunte a ' + j.nome +
        ': ficou com a maioria em ' + comMaioria + ' das ' + j.rachadas + ' rodadas em que a mesa rachou.' };
    }
    // Mesa pequena (ou que nunca rachou): compara com a pessoa mais parecida.
    if (j.rachadas < 2 && par) {
      if (par.iguais / par.juntos >= 0.7) {
        return { titulo: 'Alma gêmea', frase: 'Votou igual a ' + par.nome + ' em ' + par.iguais + ' de ' +
          par.juntos + ' rodadas.' };
      }
      if (par.iguais / par.juntos <= 0.4) {
        return { titulo: 'Do contra', frase: 'Discordou de todo mundo: quem chegou mais perto foi ' + par.nome +
          ', com ' + par.iguais + ' votos iguais em ' + par.juntos + ' rodadas.' };
      }
    }
    if (j.comOutros >= 3 && j.primeiro / j.comOutros >= 0.5) {
      return { titulo: 'Gatilho rápido', frase: 'Votou primeiro em ' + j.primeiro + ' das ' + j.comOutros +
        ' rodadas. Pensar para quê?' };
    }
    if (j.comOutros >= 3 && j.ultimo / j.comOutros >= 0.5) {
      return { titulo: 'Sem pressa', frase: 'Foi a última pessoa a votar em ' + j.ultimo + ' das ' + j.comOutros +
        ' rodadas.' };
    }
    return { titulo: 'Imprevisível', frase: j.rachadas
      ? 'Ora com a maioria (' + comMaioria + '), ora contra (' + j.minoria + '). Ninguém sabe o que vem.'
      : 'Nenhum padrão nas escolhas. Ninguém sabe o que vem.' };
  }

  // Cada pessoa ganha uma previsão diferente, sorteada pelas próprias escolhas.
  function preverTodos(jogadores, semente, nomeDoLado) {
    var usadas = new Set();
    jogadores.forEach(function (j) {
      var h = hash(semente + '|' + j.nome + '|' + j.escolhas.join(','));
      var i = h % PREVISOES.length;
      while (usadas.has(i) && usadas.size < PREVISOES.length) i = (i + 1) % PREVISOES.length;
      usadas.add(i);
      var pct = 61 + (h >>> 8) % 37;
      // Cita uma escolha de quando ficou na minoria, que diz mais sobre a pessoa.
      var base = j.minorias.length ? j.minorias : j.todas;
      var citada = base[(h >>> 16) % base.length];
      var trecho = citada ? nomeDoLado(citada.fonte, citada.lado) : null;
      j.previsao = trecho
        ? 'Quem escolhe ' + trecho + ' tem ' + pct + '% de chance de ' + PREVISOES[i] + '.'
        : 'Pelas escolhas de ' + j.nome + ', a chance é alta de ' + PREVISOES[i] + '.';
    });
  }

  function maiores(jogadores, campo, minimo) {
    var max = Math.max.apply(null, jogadores.map(function (j) { return j[campo]; }).concat([0]));
    if (max < minimo) return null;
    return { valor: max, nomes: jogadores.filter(function (j) { return j[campo] === max; }).map(function (j) { return j.nome; }) };
  }

  function destaques(jogadores, lidas, validos, nomeDoLado) {
    var lista = [];

    var fora = maiores(jogadores, 'minoria', 2);
    if (fora) {
      lista.push({ titulo: 'Fora da curva', texto: fora.nomes.length === 1
        ? fora.nomes[0] + ' ficou na minoria ' + fora.valor + ' vezes, mais do que todo mundo.'
        : juntar(fora.nomes) + ' ficaram na minoria ' + fora.valor + ' vezes cada.' });
    }

    if (validos.length) {
      var melhor = validos[0], pior = validos[validos.length - 1];
      if (melhor.iguais / melhor.juntos >= 0.7) {
        lista.push({ titulo: 'Almas gêmeas', texto: melhor.x + ' e ' + melhor.y + ' votaram igual em ' +
          melhor.iguais + ' de ' + melhor.juntos + ' rodadas.' });
      }
      if (pior !== melhor && pior.iguais / pior.juntos <= 0.4) {
        lista.push({ titulo: 'Água e óleo', texto: pior.x + ' e ' + pior.y + ' discordaram em ' +
          (pior.juntos - pior.iguais) + ' de ' + pior.juntos + ' rodadas.' });
      }
    }

    // A rodada mais dividida: menor diferença, mais votos e, no empate, a primeira.
    var divididas = lidas.filter(function (l) { return l.lados.a.length && l.lados.b.length; }).sort(function (p, q) {
      return Math.abs(p.lados.a.length - p.lados.b.length) - Math.abs(q.lados.a.length - q.lados.b.length) ||
        q.total - p.total || p.numero - q.numero;
    });
    var d = divididas[0];
    if (d && (d.lados.a.length === d.lados.b.length || d.total >= 3) && Math.abs(d.lados.a.length - d.lados.b.length) <= 1) {
      var na = nomeDoLado(d.fonte, 'a'), nb = nomeDoLado(d.fonte, 'b');
      lista.push({ titulo: 'A que mais rachou a mesa', texto: (na && nb ? na + ' ou ' + nb : 'A rodada ' + d.numero) +
        ': ' + d.lados.a.length + ' a ' + d.lados.b.length + '.' });
    }

    var comVarios = lidas.filter(function (l) { return l.total >= 2; });
    if (comVarios.length >= 3) {
      var u = comVarios.filter(function (l) { return l.unanime; }).length;
      lista.push(u
        ? { titulo: 'Unanimidade', texto: 'Todo mundo concordou em ' + u + ' de ' + comVarios.length + ' rodadas.' }
        : { titulo: 'Zero unanimidade', texto: 'A mesa não concordou por inteiro em nenhuma das ' + comVarios.length + ' rodadas.' });
    }

    var rapido = maiores(jogadores, 'primeiro', 3);
    if (rapido) {
      lista.push({ titulo: 'Gatilho mais rápido', texto: juntar(rapido.nomes) + (rapido.nomes.length === 1 ? ' votou' : ' votaram') +
        ' primeiro em ' + rapido.valor + ' rodadas' + (rapido.nomes.length === 1 ? '.' : ' cada.') });
    }
    return lista;
  }

  // rodadas: [{ rodada, opcao_a, opcao_b, votos: [{ jogador, escolha }] na ordem em que chegaram }]
  // opcoes: { semente: texto que muda a cada partida, nomeDoLado(rodada, lado) -> texto ou null }
  function calcular(rodadas, opcoes) {
    opcoes = opcoes || {};
    var nomeDoLado = opcoes.nomeDoLado || function () { return null; };
    var lidas = (rodadas || []).map(lerRodada);
    var c = contar(lidas);
    var validos = paresValidos(c.pares);
    c.jogadores.forEach(function (j) {
      j.parecido = maisParecido(j.nome, validos);
      j.perfil = perfil(j);
    });
    preverTodos(c.jogadores, opcoes.semente || '', nomeDoLado);
    return {
      rodadas: lidas.length,
      jogadores: c.jogadores.map(function (j) {
        return {
          nome: j.nome, votos: j.votos, maioria: j.maioria, minoria: j.minoria, sozinho: j.sozinho,
          primeiro: j.primeiro, parecido: j.parecido, perfil: j.perfil, previsao: j.previsao
        };
      }),
      destaques: destaques(c.jogadores, lidas, validos, nomeDoLado)
    };
  }

  var api = { calcular: calcular, hash: hash, PREVISOES: PREVISOES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Resultado = api;
})(this);
