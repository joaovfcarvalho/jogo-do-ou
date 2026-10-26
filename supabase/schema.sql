-- Jogo do Ou: esquema do banco (Supabase / Postgres).
-- O site só lê `alternativas`; toda escrita passa pelas funções abaixo
-- (security definer), que validam o que chega. As outras tabelas não têm
-- política de RLS e por isso ficam fechadas para acesso direto.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.alternativas (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo in ('boa', 'ruim')),
  texto         text not null check (char_length(texto) between 3 and 220),
  nota_inicial  numeric(3,1) not null,          -- média João/Bruno, ou palpite da IA
  fonte         text not null default 'planilha' check (fonte in ('planilha', 'ia', 'jogador')),
  adulto        boolean not null default false,
  rating        double precision not null,       -- intensidade aprendida com os votos (escala da nota)
  aparicoes     integer not null default 0,
  escolhas      integer not null default 0,      -- vezes em que a opção que a continha foi a escolhida
  sinalizacoes  integer not null default 0,      -- "sem graça"
  ativa         boolean not null default true,
  autor         text,
  criada_em     timestamptz not null default now(),
  unique (tipo, texto)
);

create table public.votos (
  id         bigint generated always as identity primary key,
  modo       text not null check (modo in ('boas', 'ruins', 'misto')),
  a_boa      bigint references public.alternativas(id),
  a_ruim     bigint references public.alternativas(id),
  b_boa      bigint references public.alternativas(id),
  b_ruim     bigint references public.alternativas(id),
  escolha    text not null check (escolha in ('a', 'b')),
  p_a        double precision not null,          -- chance de A prevista antes do voto
  jogador    text,
  sala       text,
  criado_em  timestamptz not null default now()
);

create table public.salas (
  codigo         text primary key,
  modo           text not null check (modo in ('boas', 'ruins', 'misto')),
  familia        boolean not null default false,
  anfitriao      text not null,
  rodada         integer not null default 0,
  opcao_a        jsonb,                          -- {"boa": id|null, "ruim": id|null}
  opcao_b        jsonb,
  revelada       boolean not null default false,
  p_a            double precision,               -- previsão do jogo no 1º voto da rodada
  total_rodadas  integer not null default 10 check (total_rodadas between 3 and 30),
  inicio_partida integer not null default 1,     -- 1ª rodada da partida atual
  encerrada      boolean not null default false, -- partida acabou: todo mundo vê o resultado
  atualizada_em  timestamptz not null default now(),
  criada_em      timestamptz not null default now()
);

create table public.sala_jogadores (
  sala      text not null references public.salas(codigo) on delete cascade,
  jogador   text not null,
  visto_em  timestamptz not null default now(),
  primary key (sala, jogador)
);

-- Os pares de cada rodada, para o resultado da partida.
create table public.sala_rodadas (
  sala     text not null references public.salas(codigo) on delete cascade,
  rodada   integer not null,
  opcao_a  jsonb not null,
  opcao_b  jsonb not null,
  primary key (sala, rodada)
);

create table public.sala_votos (
  sala       text not null references public.salas(codigo) on delete cascade,
  rodada     integer not null,
  jogador    text not null,
  escolha    text not null check (escolha in ('a', 'b')),
  criado_em  timestamptz not null default now(),
  primary key (sala, rodada, jogador)
);

create index votos_par_idx on public.votos (a_boa, a_ruim, b_boa, b_ruim);

alter table public.alternativas   enable row level security;
alter table public.votos          enable row level security;
alter table public.salas          enable row level security;
alter table public.sala_jogadores enable row level security;
alter table public.sala_rodadas   enable row level security;
alter table public.sala_votos     enable row level security;

create policy "leitura das alternativas ativas" on public.alternativas
  for select to anon, authenticated using (ativa);

-- ---------------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------------

-- Utilidade de uma opção: quanto vale a parte boa menos quanto pesa a ruim.
create function public._utilidade(p_boa bigint, p_ruim bigint)
returns double precision language sql stable set search_path = '' as $$
  select coalesce((select a.rating from public.alternativas a where a.id = p_boa), 0)
       - coalesce((select a.rating from public.alternativas a where a.id = p_ruim), 0)
$$;

-- A opção tem a composição que o modo pede e aponta para alternativas ativas do tipo certo?
create function public._opcao_valida(p_modo text, p_boa bigint, p_ruim bigint)
returns boolean language sql stable set search_path = '' as $$
  select case p_modo
           when 'boas'  then p_boa is not null and p_ruim is null
           when 'ruins' then p_boa is null and p_ruim is not null
           when 'misto' then p_boa is not null and p_ruim is not null
           else false
         end
     and (p_boa  is null or exists (select 1 from public.alternativas a where a.id = p_boa  and a.tipo = 'boa'  and a.ativa))
     and (p_ruim is null or exists (select 1 from public.alternativas a where a.id = p_ruim and a.tipo = 'ruim' and a.ativa))
$$;

create function public._nome(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p, '')), 20), '')
$$;

revoke execute on function public._utilidade(bigint, bigint) from public, anon, authenticated;
revoke execute on function public._opcao_valida(text, bigint, bigint) from public, anon, authenticated;
revoke execute on function public._nome(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Voto (modelo de Bradley-Terry com atualização online)
-- P(escolher A) = 1 / (1 + exp(-(U_A - U_B) / s)); cada voto move as notas
-- das alternativas envolvidas em k * (resultado - previsão).
-- ---------------------------------------------------------------------------

create function public.votar(
  p_modo text, p_a_boa bigint, p_a_ruim bigint, p_b_boa bigint, p_b_ruim bigint,
  p_escolha text, p_jogador text default null, p_sala text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k  constant double precision := 0.15;
  s  constant double precision := 0.8;
  ua double precision; ub double precision; pa double precision; d double precision;
  y  integer;
  hist_total integer; hist_a integer;
begin
  if p_escolha not in ('a', 'b')
     or not public._opcao_valida(p_modo, p_a_boa, p_a_ruim)
     or not public._opcao_valida(p_modo, p_b_boa, p_b_ruim) then
    raise exception 'voto inválido';
  end if;

  ua := public._utilidade(p_a_boa, p_a_ruim);
  ub := public._utilidade(p_b_boa, p_b_ruim);
  pa := 1 / (1 + exp(-(ua - ub) / s));
  y  := case when p_escolha = 'a' then 1 else 0 end;
  d  := k * (y - pa);

  -- Histórico deste mesmo par (nas duas ordens), antes do voto atual.
  select count(*),
         count(*) filter (where (v.escolha = 'a') = (v.a_boa is not distinct from p_a_boa and v.a_ruim is not distinct from p_a_ruim))
    into hist_total, hist_a
    from public.votos v
   where v.modo = p_modo
     and ((v.a_boa is not distinct from p_a_boa and v.a_ruim is not distinct from p_a_ruim
           and v.b_boa is not distinct from p_b_boa and v.b_ruim is not distinct from p_b_ruim)
       or (v.a_boa is not distinct from p_b_boa and v.a_ruim is not distinct from p_b_ruim
           and v.b_boa is not distinct from p_a_boa and v.b_ruim is not distinct from p_a_ruim));

  update public.alternativas set rating = least(5.5, greatest(0.5, rating + d)) where id = p_a_boa;
  update public.alternativas set rating = least(5.5, greatest(0.5, rating - d)) where id = p_a_ruim;
  update public.alternativas set rating = least(5.5, greatest(0.5, rating - d)) where id = p_b_boa;
  update public.alternativas set rating = least(5.5, greatest(0.5, rating + d)) where id = p_b_ruim;
  update public.alternativas set aparicoes = aparicoes + 1
   where id in (p_a_boa, p_a_ruim, p_b_boa, p_b_ruim);
  update public.alternativas set escolhas = escolhas + 1
   where id in (case when y = 1 then p_a_boa else p_b_boa end, case when y = 1 then p_a_ruim else p_b_ruim end);

  insert into public.votos (modo, a_boa, a_ruim, b_boa, b_ruim, escolha, p_a, jogador, sala)
  values (p_modo, p_a_boa, p_a_ruim, p_b_boa, p_b_ruim, p_escolha, pa, public._nome(p_jogador), p_sala);

  return jsonb_build_object(
    'p_a', pa,
    'historico', jsonb_build_object('total', hist_total, 'a', hist_a),
    'ratings', (select jsonb_object_agg(a.id, a.rating) from public.alternativas a
                 where a.id in (p_a_boa, p_a_ruim, p_b_boa, p_b_ruim)));
end $$;

-- "Sem graça": três sinalizações tiram a alternativa do jogo.
create function public.sinalizar(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.alternativas
     set sinalizacoes = sinalizacoes + 1,
         ativa = sinalizacoes + 1 < 3
   where id = p_id;
$$;

-- Alternativa nova sugerida por um jogador: entra na média do tipo e os votos acertam a nota.
create function public.sugerir(p_tipo text, p_texto text, p_adulto boolean, p_autor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  media double precision;
  nova  public.alternativas;
begin
  if p_tipo not in ('boa', 'ruim') or char_length(btrim(coalesce(p_texto, ''))) not between 3 and 220 then
    raise exception 'sugestão inválida';
  end if;
  select coalesce(avg(a.rating), 3) into media from public.alternativas a where a.tipo = p_tipo and a.ativa;
  insert into public.alternativas (tipo, texto, nota_inicial, fonte, adulto, rating, autor)
  values (p_tipo, btrim(p_texto), round(media::numeric, 1), 'jogador', coalesce(p_adulto, false), media, public._nome(p_autor))
  returning * into nova;
  return to_jsonb(nova);
end $$;

-- Totais para a tela inicial (e para o keep-alive do projeto gratuito).
create function public.ping()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'alternativas', (select count(*) from public.alternativas where ativa),
    'votos', (select count(*) from public.votos))
$$;

-- ---------------------------------------------------------------------------
-- Salas (vários celulares no mesmo dilema)
-- ---------------------------------------------------------------------------

create function public.estado_sala(p_codigo text, p_jogador text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.salas;
begin
  select * into s from public.salas where codigo = upper(p_codigo);
  if not found then
    return null;
  end if;
  if public._nome(p_jogador) is not null then
    update public.sala_jogadores set visto_em = now()
     where sala = s.codigo and jogador = public._nome(p_jogador);
  end if;
  return jsonb_build_object(
    'codigo', s.codigo, 'modo', s.modo, 'familia', s.familia, 'anfitriao', s.anfitriao,
    'rodada', s.rodada, 'opcao_a', s.opcao_a, 'opcao_b', s.opcao_b,
    'revelada', s.revelada, 'p_a', s.p_a,
    'total_rodadas', s.total_rodadas, 'inicio_partida', s.inicio_partida, 'encerrada', s.encerrada,
    'jogadores', coalesce((select jsonb_agg(jsonb_build_object(
                     'nome', j.jogador, 'ativo', j.visto_em > now() - interval '45 seconds') order by j.jogador)
                   from public.sala_jogadores j where j.sala = s.codigo), '[]'::jsonb),
    'votos', coalesce((select jsonb_agg(jsonb_build_object(
                     'jogador', v.jogador, 'escolha', case when s.revelada then v.escolha end) order by v.criado_em)
                   from public.sala_votos v where v.sala = s.codigo and v.rodada = s.rodada), '[]'::jsonb));
end $$;

create function public.criar_sala(p_modo text, p_familia boolean, p_jogador text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cod  text;
  nome text := public._nome(p_jogador);
begin
  if nome is null or p_modo not in ('boas', 'ruins', 'misto') then
    raise exception 'sala inválida';
  end if;
  delete from public.salas where atualizada_em < now() - interval '2 days';
  loop
    cod := '';
    for i in 1..4 loop
      cod := cod || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1);
    end loop;
    exit when not exists (select 1 from public.salas where codigo = cod);
  end loop;
  insert into public.salas (codigo, modo, familia, anfitriao) values (cod, p_modo, coalesce(p_familia, false), nome);
  insert into public.sala_jogadores (sala, jogador) values (cod, nome);
  return public.estado_sala(cod, nome);
end $$;

create function public.entrar_sala(p_codigo text, p_jogador text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  nome text := public._nome(p_jogador);
begin
  if nome is null or not exists (select 1 from public.salas where codigo = upper(p_codigo)) then
    return null;
  end if;
  insert into public.sala_jogadores (sala, jogador) values (upper(p_codigo), nome)
  on conflict (sala, jogador) do update set visto_em = now();
  return public.estado_sala(p_codigo, nome);
end $$;

-- Sai da sala: some da lista de todo mundo.
create function public.sair_sala(p_codigo text, p_jogador text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.salas;
begin
  select * into s from public.salas where codigo = upper(p_codigo) for update;
  if not found then
    return null;
  end if;
  delete from public.sala_jogadores where sala = s.codigo and jogador = public._nome(p_jogador);
  -- Se só faltava essa pessoa votar, a rodada se revela (os votos dados continuam valendo).
  if s.rodada > 0 and not s.revelada
     and exists (select 1 from public.sala_votos v where v.sala = s.codigo and v.rodada = s.rodada)
     and not exists (
       select 1 from public.sala_jogadores j
        where j.sala = s.codigo and j.visto_em > now() - interval '45 seconds'
          and not exists (select 1 from public.sala_votos v
                           where v.sala = s.codigo and v.rodada = s.rodada and v.jogador = j.jogador)) then
    update public.salas set revelada = true, atualizada_em = now() where codigo = s.codigo;
  end if;
  return public.estado_sala(s.codigo);
end $$;

-- Só avança se ninguém avançou antes (p_rodada é a rodada que o cliente estava vendo)
-- e se a partida ainda não chegou ao total de rodadas.
-- p_a/p_b vão qualificados com o nome da função porque salas também tem a coluna p_a.
create function public.nova_rodada(p_codigo text, p_rodada integer, p_a jsonb, p_b jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.salas;
begin
  select * into s from public.salas where codigo = upper(p_codigo) for update;
  if not found then
    return null;
  end if;
  if s.rodada = p_rodada
     and not s.encerrada
     and (s.rodada = 0 or s.rodada - s.inicio_partida + 1 < s.total_rodadas)
     and public._opcao_valida(s.modo, (nova_rodada.p_a->>'boa')::bigint, (nova_rodada.p_a->>'ruim')::bigint)
     and public._opcao_valida(s.modo, (nova_rodada.p_b->>'boa')::bigint, (nova_rodada.p_b->>'ruim')::bigint) then
    update public.salas
       set rodada = rodada + 1, opcao_a = nova_rodada.p_a, opcao_b = nova_rodada.p_b,
           revelada = false, p_a = null, atualizada_em = now()
     where codigo = s.codigo;
    insert into public.sala_rodadas (sala, rodada, opcao_a, opcao_b)
    values (s.codigo, s.rodada + 1, nova_rodada.p_a, nova_rodada.p_b);
  end if;
  return public.estado_sala(s.codigo);
end $$;

-- Começa uma partida (na sala nova ou depois do resultado), com o número de rodadas escolhido.
create function public.nova_partida(p_codigo text, p_rodada integer, p_total integer, p_a jsonb, p_b jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.salas;
begin
  select * into s from public.salas where codigo = upper(p_codigo) for update;
  if not found then
    return null;
  end if;
  if s.rodada = p_rodada
     and (s.rodada = 0 or s.encerrada)
     and p_total between 3 and 30
     and public._opcao_valida(s.modo, (nova_partida.p_a->>'boa')::bigint, (nova_partida.p_a->>'ruim')::bigint)
     and public._opcao_valida(s.modo, (nova_partida.p_b->>'boa')::bigint, (nova_partida.p_b->>'ruim')::bigint) then
    update public.salas
       set rodada = rodada + 1, inicio_partida = rodada + 1, total_rodadas = p_total, encerrada = false,
           opcao_a = nova_partida.p_a, opcao_b = nova_partida.p_b,
           revelada = false, p_a = null, atualizada_em = now()
     where codigo = s.codigo;
    insert into public.sala_rodadas (sala, rodada, opcao_a, opcao_b)
    values (s.codigo, s.rodada + 1, nova_partida.p_a, nova_partida.p_b);
  end if;
  return public.estado_sala(s.codigo);
end $$;

-- Voto dentro da sala: vale um por jogador por rodada, conta também no placar geral,
-- e a rodada se revela sozinha quando todos os presentes votaram.
create function public.votar_sala(p_codigo text, p_rodada integer, p_jogador text, p_escolha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s    public.salas;
  nome text := public._nome(p_jogador);
  r    jsonb;
  n    integer;
begin
  select * into s from public.salas where codigo = upper(p_codigo) for update;
  if not found or nome is null or s.rodada <> p_rodada or s.opcao_a is null or p_escolha not in ('a', 'b') then
    return public.estado_sala(p_codigo, nome);
  end if;
  insert into public.sala_votos (sala, rodada, jogador, escolha) values (s.codigo, s.rodada, nome, p_escolha)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 1 then
    r := public.votar(s.modo, (s.opcao_a->>'boa')::bigint, (s.opcao_a->>'ruim')::bigint,
                      (s.opcao_b->>'boa')::bigint, (s.opcao_b->>'ruim')::bigint, p_escolha, nome, s.codigo);
    update public.salas set p_a = coalesce(p_a, (r->>'p_a')::double precision), atualizada_em = now()
     where codigo = s.codigo;
    if not exists (
         select 1 from public.sala_jogadores j
          where j.sala = s.codigo and j.visto_em > now() - interval '45 seconds'
            and not exists (select 1 from public.sala_votos v
                             where v.sala = s.codigo and v.rodada = s.rodada and v.jogador = j.jogador)) then
      update public.salas set revelada = true where codigo = s.codigo;
    end if;
  end if;
  return public.estado_sala(s.codigo, nome);
end $$;

create function public.revelar(p_codigo text, p_rodada integer)
returns jsonb language sql security definer set search_path = '' as $$
  update public.salas set revelada = true, atualizada_em = now()
   where codigo = upper(p_codigo) and rodada = p_rodada;
  select public.estado_sala(p_codigo);
$$;

-- Fecha a partida depois de uma rodada revelada: todo mundo vai para o resultado.
create function public.encerrar(p_codigo text, p_rodada integer)
returns jsonb language sql security definer set search_path = '' as $$
  update public.salas set encerrada = true, atualizada_em = now()
   where codigo = upper(p_codigo) and rodada = p_rodada and rodada > 0 and revelada;
  select public.estado_sala(p_codigo);
$$;

-- Rodadas da partida atual com os votos na ordem em que chegaram (a rodada em
-- andamento só entra depois de revelada).
create function public.resultado_sala(p_codigo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'rodada', r.rodada, 'opcao_a', r.opcao_a, 'opcao_b', r.opcao_b,
           'votos', coalesce((select jsonb_agg(jsonb_build_object('jogador', v.jogador, 'escolha', v.escolha) order by v.criado_em)
                              from public.sala_votos v where v.sala = r.sala and v.rodada = r.rodada), '[]'::jsonb))
         order by r.rodada), '[]'::jsonb)
    from public.salas s
    join public.sala_rodadas r on r.sala = s.codigo
   where s.codigo = upper(p_codigo)
     and r.rodada >= s.inicio_partida
     and (r.rodada < s.rodada or s.revelada)
$$;
