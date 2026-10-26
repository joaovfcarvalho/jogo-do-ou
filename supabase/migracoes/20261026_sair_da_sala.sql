-- Sair da sala de verdade (pedido do João em 26/10/26): antes o botão só voltava
-- para o início e o nome continuava na lista de todo mundo.
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
