-- Partidas com fim (pedido da galera em 26/10/26): número de rodadas, encerramento
-- e os pares de cada rodada guardados para o resultado da partida.
-- Leva o banco do esquema de 25/10/26 ao de supabase/schema.sql. Não apaga nada:
-- o site antigo continua funcionando (só para de avançar depois da 10ª rodada).
alter table public.salas
  add column total_rodadas  integer not null default 10 check (total_rodadas between 3 and 30),
  add column inicio_partida integer not null default 1,
  add column encerrada      boolean not null default false;

-- Sala aberta agora começa a contar a partida da rodada em que está.
update public.salas set inicio_partida = greatest(rodada, 1);

create table public.sala_rodadas (
  sala     text not null references public.salas(codigo) on delete cascade,
  rodada   integer not null,
  opcao_a  jsonb not null,
  opcao_b  jsonb not null,
  primary key (sala, rodada)
);
alter table public.sala_rodadas enable row level security;

create or replace function public.estado_sala(p_codigo text, p_jogador text default null)
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

create or replace function public.nova_rodada(p_codigo text, p_rodada integer, p_a jsonb, p_b jsonb)
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

create function public.encerrar(p_codigo text, p_rodada integer)
returns jsonb language sql security definer set search_path = '' as $$
  update public.salas set encerrada = true, atualizada_em = now()
   where codigo = upper(p_codigo) and rodada = p_rodada and rodada > 0 and revelada;
  select public.estado_sala(p_codigo);
$$;

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
